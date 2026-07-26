// App de evaluacion: escanea las fichas con la camara y arma el puntaje por club.

import {
  CAMPORI, REGLAS, PUNTOS_EVENTO, TOPE_FISICO, TOPE_ESPIRITUAL, TODOS_LOS_ITEMS,
  CANTIDAD_EVENTOS_FISICOS,
  EVENTOS_FISICOS, EVENTOS_ESPIRITUALES, CRITERIOS_ADICIONALES, SANCIONES,
  etiquetaTipo,
} from './catalogo.js';
import { CLUBES, CLUB_PRUEBA, buscarClub } from './clubes.js';
import { leerQr } from './codigo.js';
import { calcular, ESTADOS } from './puntaje.js';
import { Escaner, VERSION_LECTOR, pitido, vibrar, activarSonido } from './escaner.js?v=5';
import { aXlsx, aCsv, descargar } from './exportar.js';
import * as sheets from './sheets.js?v=11';
import * as almacen from './almacen.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const escapar = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hoy = () => new Date().toISOString().slice(0, 10);
const CLUBES_OFICIALES = CLUBES.filter(c => c.id !== CLUB_PRUEBA);

// Muestra el puntaje con su signo: +200, -500, o — cuando no suma nada.
const signo = n => n > 0 ? `+${n}` : n < 0 ? `${n}` : '—';

const ICONOS = {
  contado: '✅', club: '🏷️', repetido: '🔁',
  serial_repetido: '🔁', serial_ajeno: '🚨',
  desconocido: '❓', invalido: '❌', desplazado: '⚖️',
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
  versionSheets: 0,
  sincronizando: false,
  reconciliando: false,
  pendientes: new Set(),
  eventosPendientes: new Map(), // ID club -> códigos de las celdas modificadas
  revisionesPendientes: new Map(), // ID club -> versión local de sus cambios
  versionCambiosPendientes: 0,
  clubesEnMutacion: new Map(), // ID club -> operaciones locales aún no encoladas
  eventosHoja: [],
  puntajesHoja: new Map(),
  detalleDisponible: null,
  revisionesDetalle: new Map(),
  urlRevisionesDetalle: '',
  temporizadorSync: null,
  intervaloSync: null,
  resolverDecisionCache: null,
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

function resultadoLocal(idClub, escaneos) {
  return calcular(escaneos, {
    usadosPorOtros: usadosPorOtros(idClub),
  });
}

function puntajesPorEvento(resultado) {
  return sheets.puntajesDesdeDetalle(
    resultado.detalle,
    TODOS_LOS_ITEMS.map(e => e.codigo)
  );
}

function codigosQueCambiaron(antes, despues) {
  const a = puntajesPorEvento(antes);
  const b = puntajesPorEvento(despues);
  return TODOS_LOS_ITEMS.map(e => e.codigo).filter(codigo => a[codigo] !== b[codigo]);
}

/**
 * Google Sheets manda para los números visibles. Mientras un cambio local está
 * pendiente, se superponen únicamente las celdas que ese teléfono modificó.
 */
function resultadoConPuntajesDeHoja(idClub, base) {
  const remota = estado.puntajesHoja.get(idClub);
  if (!remota) return base;

  const locales = puntajesPorEvento(base);
  const valores = sheets.aplicarConflictosDeSerial(
    remota.eventos,
    locales,
    base.detalle
  );
  const pendientes = estado.eventosPendientes.get(idClub);
  if (pendientes?.size) {
    for (const codigo of pendientes) valores[codigo] = locales[codigo] || 0;
  }

  const deTipo = (catalogo, tipo) => {
    const eventos = catalogo
      .filter(e => Number(valores[e.codigo]) !== 0)
      .map(e => ({ evento: { ...e, tipo }, puntos: Number(valores[e.codigo]) || 0 }));
    return { eventos, puntos: eventos.reduce((t, x) => t + x.puntos, 0) };
  };
  const fisico = deTipo(EVENTOS_FISICOS, 'fisico');
  const espiritual = deTipo(EVENTOS_ESPIRITUALES, 'espiritual');
  const adicional = deTipo(CRITERIOS_ADICIONALES, 'adicional');
  const sancion = deTipo(SANCIONES, 'sancion');
  const faltantes = EVENTOS_ESPIRITUALES.filter(e => !(Number(valores[e.codigo]) > 0));
  const totalBruto = fisico.puntos + espiritual.puntos + adicional.puntos + sancion.puntos;

  return {
    ...base,
    fisico: {
      ...base.fisico,
      puntos: fisico.puntos,
      hechos: fisico.eventos.length,
      eventos: fisico.eventos,
    },
    espiritual: {
      ...base.espiritual,
      puntos: espiritual.puntos,
      hechos: espiritual.eventos.length,
      eventos: espiritual.eventos,
      faltantes,
    },
    adicional: { ...base.adicional, puntos: adicional.puntos, eventos: adicional.eventos },
    sancion: {
      ...base.sancion,
      puntos: sancion.puntos,
      eventos: sancion.eventos,
      cantidad: base.sancion.cantidad || sancion.eventos.length,
    },
    totalBruto,
    total: Math.max(0, totalBruto),
    totalBase: fisico.puntos + espiritual.puntos,
    completo: faltantes.length === 0
      && fisico.eventos.length >= REGLAS.fisicosMinimosParaCompletar,
  };
}

function resultadoDe(idClub, escaneos) {
  return resultadoConPuntajesDeHoja(idClub, resultadoLocal(idClub, escaneos));
}

/**
 * Compara el cálculo auditable desde los QR de Detalle con la matriz que manda en
 * pantalla. Los cambios locales pendientes se omiten porque todavía están viajando.
 */
function auditarConsistenciaPuntajes() {
  const diferencias = [];
  const totalesIncorrectos = [];
  const clubesFaltantes = [];
  const codigosHoja = new Set(estado.eventosHoja.map(e => e.codigo));
  const eventosFaltantes = TODOS_LOS_ITEMS
    .map(e => e.codigo)
    .filter(codigo => !codigosHoja.has(codigo));
  if (estado.versionSheets < 2 || !estado.puntajesHoja.size) {
    return {
      disponible: false,
      diferencias,
      totalesIncorrectos,
      clubesFaltantes,
      eventosFaltantes,
      clubes: 0,
      celdas: 0,
    };
  }

  const escaneosPorClub = new Map();
  for (const escaneo of estado.todos) {
    if (!escaneosPorClub.has(escaneo.idClub)) escaneosPorClub.set(escaneo.idClub, []);
    escaneosPorClub.get(escaneo.idClub).push(escaneo);
  }
  const codigos = TODOS_LOS_ITEMS.map(e => e.codigo);

  for (const club of CLUBES_OFICIALES) {
    const remota = estado.puntajesHoja.get(club.id);
    if (!remota) {
      clubesFaltantes.push({ idClub: club.id, club: club.nombre });
      continue;
    }
    const pendientes = estado.eventosPendientes.get(club.id);
    const pendienteLegado = estado.pendientes.has(club.id) && !pendientes;
    const locales = puntajesPorEvento(resultadoLocal(
      club.id,
      escaneosPorClub.get(club.id) || []
    ));
    if (!pendienteLegado) {
      for (const diferencia of sheets.diferenciasDePuntajes(locales, remota.eventos, codigos)) {
        if (!pendientes?.has(diferencia.codigo)) {
          diferencias.push({ idClub: club.id, club: club.nombre, ...diferencia });
        }
      }
    }

    if (!estado.pendientes.has(club.id)) {
      const calculado = sheets.totalDesdeEventos(remota.eventos);
      const valorIncorrecto = calculado !== Number(remota.total || 0);
      const formulaIncorrecta = estado.versionSheets >= 3 && !remota.totalConFormula;
      if (valorIncorrecto || formulaIncorrecta) {
        totalesIncorrectos.push({
          idClub: club.id,
          club: club.nombre,
          remoto: Number(remota.total || 0),
          calculado,
          formulaIncorrecta,
        });
      }
    }
  }

  return {
    disponible: true,
    diferencias,
    totalesIncorrectos,
    clubesFaltantes,
    eventosFaltantes,
    clubes: new Set(diferencias.map(d => d.idClub)).size,
    celdas: diferencias.length,
  };
}

function cantidadProblemasAuditoria(auditoria) {
  return auditoria.celdas
    + auditoria.totalesIncorrectos.length
    + auditoria.clubesFaltantes.length
    + auditoria.eventosFaltantes.length;
}

function matrizNecesitaPreparacion() {
  const codigos = new Set(estado.eventosHoja.map(e => e.codigo));
  const ids = new Set(estado.puntajesHoja.keys());
  return TODOS_LOS_ITEMS.some(e => !codigos.has(e.codigo))
    || CLUBES_OFICIALES.some(club => !ids.has(club.id));
}

function pintarAvisoConsistencia() {
  const caja = $('#aviso-consistencia');
  if (!caja) return;
  const auditoria = auditarConsistenciaPuntajes();
  const problemas = cantidadProblemasAuditoria(auditoria);
  caja.classList.toggle('oculto', !auditoria.disponible || problemas === 0);
  if (!auditoria.disponible || problemas === 0) {
    caja.textContent = '';
    return;
  }
  const partes = [];
  if (auditoria.celdas) {
    partes.push(`${auditoria.celdas} celda${auditoria.celdas === 1 ? '' : 's'} de ` +
      `${auditoria.clubes} club${auditoria.clubes === 1 ? '' : 'es'} no coinciden con sus QR`);
  }
  if (auditoria.totalesIncorrectos.length) {
    partes.push(`${auditoria.totalesIncorrectos.length} TOTAL tiene un valor o fórmula incorrectos`);
  }
  if (auditoria.clubesFaltantes.length) {
    partes.push(`${auditoria.clubesFaltantes.length} clubes faltan en la matriz`);
  }
  if (auditoria.eventosFaltantes.length) {
    partes.push(`${auditoria.eventosFaltantes.length} columnas de eventos faltan en la matriz`);
  }
  caja.innerHTML = `<strong>⚠️ Revisión de puntajes:</strong> ${escapar(partes.join('; '))}. ` +
    'En Ajustes podés normalizar el molde, comparar y recalcular explícitamente desde Detalle.';
}

function clubesConVariosEvaluadores() {
  const porClub = new Map();
  for (const escaneo of estado.todos) {
    const nombre = String(escaneo.dispositivo || '').trim();
    if (!nombre) continue;
    if (!porClub.has(escaneo.idClub)) porClub.set(escaneo.idClub, new Set());
    porClub.get(escaneo.idClub).add(nombre);
  }
  return [...porClub].filter(([, nombres]) => nombres.size > 1);
}

function clubTienePuntaje(idClub, escaneos = []) {
  if (escaneos.length) return true;
  return Object.values(estado.puntajesHoja.get(idClub)?.eventos || {})
    .some(valor => Number(valor) !== 0);
}

/** Recalcula todos los clubes de una. Se usa en la vista de resultados y al exportar. */
function resultadosDeTodos() {
  const porClub = new Map();
  for (const e of estado.todos) {
    if (!porClub.has(e.idClub)) porClub.set(e.idClub, []);
    porClub.get(e.idClub).push(e);
  }
  return CLUBES_OFICIALES.map(club => {
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
  pintarAvisoConsistencia();
  const texto = $('#buscar').value.trim().toLowerCase();
  const region = $('#filtro-region').value;
  const filtroEstado = $('#filtro-estado').value;
  const todos = resultadosDeTodos();

  const visibles = todos.filter(({ club, escaneos, resultado, ficha }) => {
    const conPuntaje = clubTienePuntaje(club.id, escaneos);
    if (region && club.region !== region) return false;
    if (texto && ![club.nombre, club.iglesia, club.region, club.id, club.distrito]
      .some(c => String(c).toLowerCase().includes(texto))) return false;
    if (filtroEstado === 'sin' && conPuntaje) return false;
    if (filtroEstado === 'curso' && (!conPuntaje || ficha?.cerrada)) return false;
    if (filtroEstado === 'cerrada' && !ficha?.cerrada) return false;
    if (filtroEstado === 'alerta' && !resultado.alertas.some(a => a.nivel === 'alerta')) return false;
    return true;
  });

  if (!visibles.length) {
    $('#lista-clubes').innerHTML = '<p class="tenue chico">Ningún club coincide con el filtro.</p>';
    return;
  }

  $('#lista-clubes').innerHTML = visibles.map(({ club, escaneos, resultado, ficha }) => {
    const conPuntaje = clubTienePuntaje(club.id, escaneos);
    const graves = resultado.alertas.filter(a => a.nivel === 'alerta').length;
    const marcas = [];
    if (ficha?.cerrada) marcas.push('<span class="pastilla ok">terminada</span>');
    else if (conPuntaje) marcas.push('<span class="pastilla info">en curso</span>');
    if (graves) marcas.push(`<span class="pastilla alerta">${graves} alerta${graves === 1 ? '' : 's'}</span>`);
    if (conPuntaje) {
      marcas.push(`<span class="pastilla">F ${resultado.fisico.hechos}/${CANTIDAD_EVENTOS_FISICOS}</span>`);
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
  marcador('#m-fisicos', `${r.fisico.hechos}/${CANTIDAD_EVENTOS_FISICOS}`,
    r.fisico.hechos >= REGLAS.fisicosMinimosParaCompletar ? 'completo' : r.fisico.hechos ? 'falta' : '');
  marcador('#m-espirituales', `${r.espiritual.hechos}/${REGLAS.espiritualesObligatorios}`,
    r.espiritual.faltantes.length === 0 ? 'completo' : r.espiritual.hechos ? 'falta' : '');
  marcador('#m-adicional', r.adicional.puntos, '');
  // La sancion solo se muestra cuando el club tiene alguna: lo normal es que no.
  const mSancion = $('#m-sancion');
  if (r.sancion.cantidad) {
    mSancion.hidden = false;
    mSancion.querySelector('.valor').textContent = r.sancion.puntos;
  } else {
    mSancion.hidden = true;
  }
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
          <span class="pts ${d.puntos < 0 ? 'resta' : ''}">${signo(d.puntos)}</span>
          <button class="quitar" data-crudo="${escapar(d.escaneo.crudo)}">quitar</button>
        </div>`;
      }).join('')
    : '<p class="tenue chico">Todavía no escaneaste nada.</p>';

  $$('#lista-escaneos .quitar').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('¿Quitar este escaneo de la ficha?')) return;
    const idClub = estado.club.id;
    await duranteMutacionClub(idClub, async () => {
      const escaneosAntes = await almacen.escaneosDeClub(idClub);
      const antes = resultadoLocal(idClub, escaneosAntes);
      await almacen.borrarEscaneo(idClub, b.dataset.crudo);
      const escaneosDespues = await recargarEscaneosDeClub(idClub);
      const despues = resultadoLocal(idClub, escaneosDespues);
      await marcarPendiente(idClub, codigosQueCambiaron(antes, despues));
      if (estado.club?.id === idClub) pintarFicha();
    });
  }));

  const ficha = estado.fichas.get(estado.club.id);
  $('#cerrar-ficha').textContent = ficha?.cerrada ? 'Reabrir ficha' : 'Marcar ficha como terminada';
}

async function recargarEscaneosDeClub(idClub) {
  const escaneos = await almacen.escaneosDeClub(idClub);
  estado.todos = await almacen.todosLosEscaneos();
  if (estado.club?.id === idClub) estado.escaneos = escaneos;
  return escaneos;
}

async function recargarEscaneos() {
  if (!estado.club) return [];
  const escaneos = await recargarEscaneosDeClub(estado.club.id);
  pintarFicha();
  return escaneos;
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

  const idClub = estado.club.id;
  const nombreClub = estado.club.nombre;
  await duranteMutacionClub(idClub, async () => {
    const escaneosAntes = await almacen.escaneosDeClub(idClub);
    const antes = resultadoLocal(idClub, escaneosAntes);
    const guardado = await almacen.agregarEscaneo({
      idClub,
      crudo: lectura.crudo,
      dispositivo: estado.dispositivo,
    });
    if (guardado === 'duplicado') {
      pitido('aviso'); vibrar('aviso');
      const evento = leerQr(lectura.crudo);
      avisar('aviso', '🔁', 'Este sticker ya estaba cargado',
        `El sticker ${evento.id} ya figura en la ficha de ${nombreClub}.`);
      return;
    }

    const escaneosDespues = await recargarEscaneosDeClub(idClub);
    const despues = resultadoLocal(idClub, escaneosDespues);
    await marcarPendiente(idClub, codigosQueCambiaron(antes, despues));
    if (estado.club?.id === idClub) pintarFicha();

    // Buscamos como quedó ESTE escaneo dentro del resultado recalculado, para poder
    // avisar exactamente por qué se contó o por qué no.
    const r = resultadoDe(idClub, escaneosDespues);
    const mio = r.detalle.find(d => d.escaneo.crudo === lectura.crudo);
    if (!mio) return;

    const info = ESTADOS[mio.estado];
    const nombre = mio.evento ? mio.evento.nombre : lectura.crudo;
    if (mio.estado === 'contado' && mio.evento.tipo === 'sancion') {
      // Una sanción entró bien, pero es mala noticia: se muestra en rojo y con
      // sonido de aviso, no con el tono de éxito de los eventos.
      pitido('aviso'); vibrar('aviso');
      avisar('alerta', '⛔', `${mio.puntos} · ${nombre}`,
        `Sanción · total del club: ${r.total} pts`);
    } else if (mio.estado === 'contado') {
      pitido('ok'); vibrar('ok');
      avisar('ok', '✅', `${signo(mio.puntos)} · ${nombre}`,
        `${etiquetaTipo(mio.evento.tipo)} · total del club: ${r.total} pts`);
    } else {
      const grave = info.nivel === 'alerta';
      pitido(grave ? 'error' : 'aviso'); vibrar(grave ? 'error' : 'aviso');
      avisar(info.nivel, ICONOS[mio.estado] || '⚠️', `${info.etiqueta}: ${nombre}`, mio.detalleTexto || '');
    }
  });
}

let colaCodigos = Promise.resolve();
function encolarCodigo(texto) {
  colaCodigos = colaCodigos
    .then(() => procesarCodigo(texto))
    .catch(error => {
      console.error(error);
      avisar('alerta', '❌', 'No se pudo guardar el QR', error?.message || String(error));
    });
  return colaCodigos;
}

// ------------------------------------------------------------------ camara

async function encenderCamara() {
  try {
    // Este click es el gesto que iOS exige para poder emitir sonido despues.
    activarSonido();
    $('#mensaje-camara').textContent = 'Pidiendo permiso de cámara…';
    estado.escaner = new Escaner($('#video'), texto => { encolarCodigo(texto); });
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
  const conDatos = todos.filter(t => clubTienePuntaje(t.club.id, t.escaneos));
  const cerradas = todos.filter(t => t.ficha?.cerrada).length;
  const conAlertas = conDatos.filter(t => t.resultado.alertas.some(a => a.nivel === 'alerta')).length;
  const puntos = conDatos.reduce((t, x) => t + x.resultado.total, 0);

  const tarjeta = (valor, rotulo, clase = '') =>
    `<div class="marcador"><div class="valor ${clase}">${valor}</div><div class="rotulo">${rotulo}</div></div>`;
  $('#totales-generales').innerHTML =
    tarjeta(`${conDatos.length}/${CLUBES_OFICIALES.length}`, 'clubes con escaneos') +
    tarjeta(cerradas, 'fichas terminadas') +
    tarjeta(conAlertas, 'clubes con alertas', conAlertas ? 'tenue' : '') +
    tarjeta(conDatos.length ? Math.round(puntos / conDatos.length) : 0, 'promedio de puntos');

  const orden = [...todos].sort((a, b) => b.resultado.total - a.resultado.total);
  $('#tabla-resultados tbody').innerHTML = orden.map(({ club, escaneos, resultado, ficha }) => {
    const graves = resultado.alertas.filter(a => a.nivel === 'alerta').length;
    let marca = '<span class="tenue">sin evaluar</span>';
    if (graves) marca = `<span class="pastilla alerta">${graves} alerta${graves === 1 ? '' : 's'}</span>`;
    else if (ficha?.cerrada) marca = '<span class="pastilla ok">terminada</span>';
    else if (clubTienePuntaje(club.id, escaneos)) marca = '<span class="pastilla info">en curso</span>';
    return `<tr>
      <td>${escapar(club.nombre)}</td>
      <td class="tenue">${escapar(club.region)}</td>
      <td class="num">${resultado.fisico.puntos}</td>
      <td class="num">${resultado.espiritual.puntos}</td>
      <td class="num">${resultado.adicional.puntos}</td>
      <td class="num ${resultado.sancion.puntos < 0 ? 'resta' : 'tenue'}">${resultado.sancion.puntos || '—'}</td>
      <td class="num"><strong>${resultado.total}</strong></td>
      <td>${marca}</td>
    </tr>`;
  }).join('');
}

/**
 * Arma las hojas del Excel y del envio a Google Sheets.
 *
 * `soloConEscaneos` importa cuando evalua mas de una persona: si un telefono manda
 * todo el padrón, los que no evaluó irían con cero y pisarían en la planilla el
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
      'Puntos adicionales', 'Sanciones', 'Puntos sanción', 'TOTAL', 'Espirituales faltantes',
      'Alertas graves', 'Avisos', 'Estado'],
    ...todos.map(({ club, escaneos, resultado, ficha }) => [
      club.id, club.nombre, club.region, club.iglesia, club.distrito, club.director,
      resultado.fisico.hechos, resultado.fisico.puntos,
      resultado.espiritual.hechos, resultado.espiritual.puntos,
      resultado.adicional.puntos,
      resultado.sancion.cantidad, resultado.sancion.puntos,
      resultado.total,
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
    ['Clubes en el padrón', CLUBES_OFICIALES.length],
    ['Puntos por evento físico/espiritual', PUNTOS_EVENTO],
    ['Eventos físicos', `${CANTIDAD_EVENTOS_FISICOS} disponibles; todos los distintos suman`],
    ['Meta física para completar', REGLAS.fisicosMinimosParaCompletar],
    ['Máximo físico', TOPE_FISICO],
    ['Eventos espirituales', `${REGLAS.espiritualesObligatorios}, todos obligatorios`],
    ['Máximo espiritual', TOPE_ESPIRITUAL],
    ['Máximo base', TOPE_FISICO + TOPE_ESPIRITUAL],
  ];

  // claveColumna le dice al script de Google por que columna fusionar. Las hojas
  // sin clave (los parametros) se reescriben enteras en cada envio.
  return [
    { nombre: 'Puntajes', filas: puntajes, claveColumna: 0, clubesReemplazar: ids ? [...ids] : undefined, anchos: [7, 26, 11, 20, 18, 26, 13, 13, 15, 15, 14, 10, 13, 10, 40, 13, 8, 12] },
    { nombre: 'Detalle de escaneos', filas: detalle, claveColumna: 0, clubesReemplazar: ids ? [...ids] : undefined, anchos: [7, 24, 11, 7, 8, 34, 11, 22, 8, 40, 16, 19, 24, 16] },
    { nombre: 'Alertas', filas: alertas, claveColumna: 0, clubesReemplazar: ids ? [...ids] : undefined, anchos: [7, 24, 11, 8, 90] },
    { nombre: 'Parámetros', filas: parametros, reemplazar: true, anchos: [30, 50] },
  ];
}

// ------------------------------------------------------------------ Google Sheets

function mostrarEstadoSheets(nivel, texto) {
  $('#sheets-estado').innerHTML = `<div class="aviso-caja ${nivel}">${escapar(texto)}</div>`;
}

function urlSheetsActual() {
  return String($('#sheets-url')?.value || estado.urlRevisionesDetalle || '').trim();
}

async function guardarRevisionesDetalle() {
  const url = urlSheetsActual();
  estado.urlRevisionesDetalle = url;
  await almacen.guardarAjuste(
    'revisionesDetalle',
    sheets.serializarRevisionesDetalle(url, estado.revisionesDetalle)
  );
}

async function asegurarUrlRevisionesDetalle(url) {
  const limpia = String(url || '').trim();
  if (estado.urlRevisionesDetalle === limpia) return;
  estado.urlRevisionesDetalle = limpia;
  estado.revisionesDetalle.clear();
  await guardarRevisionesDetalle();
}

async function guardarSheets() {
  const url = $('#sheets-url').value.trim();
  const clave = $('#sheets-clave').value;
  await asegurarUrlRevisionesDetalle(url);
  await almacen.guardarAjuste('sheetsUrl', url);
  await almacen.guardarAjuste('sheetsClave', clave);
  $('#conexion-url').value = url;
  $('#conexion-clave').value = clave;
  mostrarEstadoSheets('ok', 'Guardado en este teléfono. No se sube al repositorio.');
}

let colaDatos = Promise.resolve();
let finReconciliacion = Promise.resolve();
let liberarReconciliacion = null;

function iniciarReconciliacion() {
  estado.reconciliando = true;
  finReconciliacion = new Promise(resolver => { liberarReconciliacion = resolver; });
}

function terminarReconciliacion() {
  estado.reconciliando = false;
  const liberar = liberarReconciliacion;
  liberarReconciliacion = null;
  if (liberar) liberar();
}

async function esperarFinReconciliacion() {
  while (estado.reconciliando) await finReconciliacion;
}

async function conDatosExclusivos(tarea) {
  const anterior = colaDatos;
  let liberar;
  colaDatos = new Promise(resolver => { liberar = resolver; });
  await anterior;
  try {
    return await tarea();
  } finally {
    liberar();
  }
}

function iniciarMutacionClub(idClub) {
  const cantidad = Number(estado.clubesEnMutacion.get(idClub)) || 0;
  estado.clubesEnMutacion.set(idClub, cantidad + 1);
}

function terminarMutacionClub(idClub) {
  const cantidad = (Number(estado.clubesEnMutacion.get(idClub)) || 1) - 1;
  if (cantidad > 0) estado.clubesEnMutacion.set(idClub, cantidad);
  else estado.clubesEnMutacion.delete(idClub);
}

async function duranteMutacionClub(idClub, tarea) {
  // Una lectura de cámara que llegue mientras se compara queda en espera y se
  // procesa después. No se mezcla con el parche inmutable de reconciliación.
  await esperarFinReconciliacion();
  iniciarMutacionClub(idClub);
  try {
    return await conDatosExclusivos(tarea);
  } finally {
    terminarMutacionClub(idClub);
  }
}

async function guardarPendientes() {
  await almacen.guardarAjuste('clubesPendientes', [...estado.pendientes]);
  await almacen.guardarAjuste(
    'eventosPendientes',
    [...estado.eventosPendientes].map(([id, codigos]) => [id, [...codigos]])
  );
  await guardarRevisionesDetalle();
}

function registrarCambioPendiente(idClub) {
  estado.versionCambiosPendientes += 1;
  const anterior = Number(estado.revisionesPendientes.get(idClub)) || 0;
  estado.revisionesPendientes.set(idClub, anterior + 1);
}

function agregarPendienteEnMemoria(idClub, codigos = null) {
  if (!idClub || idClub === CLUB_PRUEBA) return false;
  registrarCambioPendiente(idClub);
  estado.pendientes.add(idClub);
  if (!estado.eventosPendientes.has(idClub)) estado.eventosPendientes.set(idClub, new Set());
  const conjunto = estado.eventosPendientes.get(idClub);
  const afectados = codigos == null ? TODOS_LOS_ITEMS.map(e => e.codigo) : codigos;
  for (const codigo of afectados) {
    if (TODOS_LOS_ITEMS.some(e => e.codigo === codigo)) conjunto.add(codigo);
  }
  return true;
}

async function marcarPendiente(idClub, codigos = null) {
  if (!agregarPendienteEnMemoria(idClub, codigos)) return;
  await guardarPendientes();
  programarSincronizacion();
}

function programarSincronizacion() {
  clearTimeout(estado.temporizadorSync);
  estado.temporizadorSync = setTimeout(() => sincronizarAutomaticamente(), 900);
}

async function enviarClubes(idsClub, silencioso = false, { soloPuntajes = false } = {}) {
  const ids = [...new Set(idsClub || [])].filter(id => id && id !== CLUB_PRUEBA);
  if (!ids.length) return { ok: true, hojas: [] };
  const revisionesEnviadas = sheets.capturarRevisionesPendientes(
    estado.revisionesPendientes,
    ids
  );
  const url = $('#sheets-url').value.trim();
  const clave = $('#sheets-clave').value;
  if (!url || !clave) return { ok: false, error: 'Falta conectar la aplicación con Google Sheets.' };

  if (!silencioso) mostrarEstadoSheets('', `Enviando ${ids.length} club${ids.length === 1 ? '' : 'es'}…`);
  const hojas = soloPuntajes ? [] : hojasParaExportar({ idsClub: ids });
  const nombres = resultadosDeTodos()
    .filter(t => ids.includes(t.club.id))
    .map(t => t.club.nombre);
  const porClub = new Map(resultadosDeTodos().map(t => [t.club.id, t]));
  const cambios = ids.map(idClub => {
    const datosClub = porClub.get(idClub);
    const locales = puntajesPorEvento(resultadoLocal(idClub, datosClub?.escaneos || []));
    const remotos = estado.puntajesHoja.get(idClub)?.eventos || {};
    const guardados = estado.eventosPendientes.get(idClub);
    // Compatibilidad con pendientes creados por una versión anterior, que todavía
    // no guardaba qué columnas había tocado.
    const codigos = guardados ? [...guardados] : TODOS_LOS_ITEMS.map(e => e.codigo);
    const eventos = {};
    const anteriores = {};
    for (const codigo of codigos) {
      eventos[codigo] = Number(locales[codigo]) || 0;
      anteriores[codigo] = Number(remotos[codigo]) || 0;
    }
    const cambio = {
      idClub,
      eventos,
      anteriores,
      estado: datosClub?.ficha?.cerrada ? 'Terminada'
        : datosClub?.escaneos?.length ? 'En curso' : 'Sin evaluar',
    };
    if (estado.versionSheets >= 3) {
      cambio.revisionDetalle = estado.revisionesDetalle.get(idClub) || '';
    }
    return cambio;
  });
  if (estado.versionSheets >= 3 && cambios.some(cambio => !cambio.revisionDetalle)) {
    return {
      ok: false,
      error: 'No existe una huella base segura para uno de los clubes guardados en caché, ' +
        'y Google Sheets ya tiene escaneos para ese club. Para no pisarlos, elegí ' +
        '"Descartar cambios locales y usar Google Sheets" o revisá el caso manualmente.',
    };
  }

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
    CAMPORI.nombre,
    {
      cambios,
      padron: padronParaSheets(),
      eventos: eventosParaSheets(),
    }
  );

  const aplicados = Array.isArray(r.aplicados)
    ? r.aplicados
    : r.ok ? ids : [];
  if (aplicados.length) {
    if (Number(r.version) >= 3) {
      const revisionesConfirmadas = sheets.normalizarRevisionesDetalle(r.revisionesDetalle);
      const sinRevision = aplicados.filter(idClub => !revisionesConfirmadas.has(idClub));
      if (sinRevision.length) {
        return {
          ...r,
          ok: false,
          error: 'El Apps Script aplicó cambios pero no devolvió su nueva huella de Detalle. ' +
            'Se conservaron como pendientes; publicá la versión actual de herramientas/apps-script.gs.',
        };
      }
      estado.revisionesDetalle = sheets.aplicarRevisionesConfirmadas(
        estado.revisionesDetalle,
        revisionesConfirmadas,
        aplicados
      );
      await guardarRevisionesDetalle();
    }
    sheets.confirmarPendientesAplicados(
      aplicados,
      revisionesEnviadas,
      estado.revisionesPendientes,
      estado.pendientes,
      estado.eventosPendientes
    );
    await guardarPendientes();
    if (!silencioso) mostrarEstadoSheets('ok', 'Cambios enviados. Actualizando desde la planilla…');
  }
  if (Array.isArray(r.conflictos) && r.conflictos.length && !silencioso) {
    mostrarEstadoSheets(
      'alerta',
      `Se detectaron ${r.conflictos.length} cambio${r.conflictos.length === 1 ? '' : 's'} más reciente(s) ` +
      'en la planilla. Refrescá y volvé a aplicar únicamente tu cambio.'
    );
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
  if (r.detalleDisponible === false) {
    return {
      ok: false,
      requierePreparacion: true,
      error: 'Falta la hoja "Detalle de escaneos". No se reemplazó la copia local. ' +
        'Volvé a preparar la planilla antes de sincronizar.',
    };
  }
  return conDatosExclusivos(async () => {
    const protegidosActuales = sheets.clubesProtegidosParaLectura(
      estado.pendientes,
      estado.clubesEnMutacion
    );
    const cantidadDetalleLocalNoProtegida = estado.todos
      .filter(e => e.idClub !== CLUB_PRUEBA && !protegidosActuales.has(e.idClub)).length;
    if (sheets.detalleRemotoVacioEsSospechoso(
      cantidadDetalleLocalNoProtegida,
      r.escaneos
    )) {
      return {
        ok: false,
        detalleVacio: true,
        error: 'Google Sheets devolvió Detalle completamente vacío. ' +
          'Por seguridad no se borró la copia de este teléfono; revisá el historial de la planilla.',
      };
    }

    const escaneos = sheets.normalizarEscaneos(r.escaneos);
    await almacen.reemplazarEscaneos(escaneos, protegidosActuales);
    estado.todos = await almacen.todosLosEscaneos();
    if (estado.club) estado.escaneos = await almacen.escaneosDeClub(estado.club.id);
    estado.versionSheets = Number(r.version) || 0;
    estado.detalleDisponible = r.detalleDisponible !== false;
    estado.revisionesDetalle = sheets.combinarRevisionesDetalle(
      estado.revisionesDetalle,
      sheets.normalizarRevisionesDetalle(r.revisionesDetalle),
      protegidosActuales,
      new Set(escaneos.map(escaneo => escaneo.idClub))
    );
    await guardarRevisionesDetalle();
    if (Array.isArray(r.eventos) && Array.isArray(r.puntajes)) {
      estado.eventosHoja = sheets.normalizarEventos(r.eventos);
      estado.puntajesHoja = sheets.normalizarPuntajes(r.puntajes, estado.eventosHoja);
      await almacen.guardarAjuste('eventosHoja', estado.eventosHoja);
      await almacen.guardarAjuste('puntajesHoja', [...estado.puntajesHoja]);
    }

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
    if (estado.vista === 'ajustes') pintarDiagnostico();
    return { ok: true };
  });
}

async function traerDeSheets(silencioso = false) {
  const url = $('#sheets-url').value.trim() || await almacen.leerAjuste('sheetsUrl', '');
  const clave = $('#sheets-clave').value || await almacen.leerAjuste('sheetsClave', '');
  if (!url || !clave) {
    const falta = { ok: false, error: 'Falta la dirección o la clave de Google Sheets.' };
    if (!silencioso) mostrarEstadoSheets('aviso', falta.error);
    return falta;
  }
  await asegurarUrlRevisionesDetalle(url);

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
    const fuente = estado.versionSheets >= 2
      ? `${estado.puntajesHoja.size} filas de puntajes y ${estado.todos.length} escaneos`
      : `${estado.todos.length} escaneos de ${r.clubes || 0} clubes`;
    mostrarEstadoSheets('ok', `Sincronizado: ${fuente}. Los valores actuales de Google Sheets ya están reflejados.`);
  }
  return r;
}

async function sincronizarAutomaticamente({ forzarEnvio = false } = {}) {
  // Hasta que el evaluador elija Subir o Descartar, ningún temporizador puede
  // publicar silenciosamente la copia local que encontró en este teléfono.
  if (!estado.conectado && !forzarEnvio) return;
  if (estado.sincronizando || estado.reconciliando || !navigator.onLine) return;
  const url = $('#sheets-url').value.trim();
  const clave = $('#sheets-clave').value;
  if (!url || !clave) return;

  const versionAlIniciar = estado.versionCambiosPendientes;
  estado.sincronizando = true;
  try {
    const ids = [...estado.pendientes]
      .filter(idClub => !estado.clubesEnMutacion.has(idClub));
    if (ids.length) {
      const enviada = await enviarClubes(ids, !forzarEnvio);
      if (!enviada.ok && forzarEnvio) mostrarEstadoSheets('alerta', enviada.error || 'No se pudo enviar.');
    }
    await traerDeSheets(!forzarEnvio);
  } finally {
    estado.sincronizando = false;
    if (sheets.debeReprogramarSincronizacion(
      versionAlIniciar,
      estado.versionCambiosPendientes,
      estado.pendientes.size
    )) {
      programarSincronizacion();
    }
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

function padronParaSheets() {
  return CLUBES_OFICIALES.map(({ id, nombre, region }) => ({ id, nombre, region }));
}

function eventosParaSheets() {
  return TODOS_LOS_ITEMS.map(({ codigo, nombre, tipo, puntos }) =>
    ({ codigo, nombre, tipo, puntos })
  );
}

async function enviarReparacionesPuntajes(cambios) {
  const url = $('#sheets-url').value.trim();
  const clave = $('#sheets-clave').value;
  if (!url || !clave) return { ok: false, error: 'Falta conectar la aplicación con Google Sheets.' };
  await asegurarUrlRevisionesDetalle(url);
  return sheets.enviar(
    {
      url,
      clave,
      dispositivo: estado.dispositivo || 'control de consistencia',
      clubes: cambios.map(cambio => cambio.idClub).join(', '),
    },
    [],
    CAMPORI.nombre,
    {
      cambios,
      padron: padronParaSheets(),
      eventos: eventosParaSheets(),
    }
  );
}

async function reconciliarPuntajesDesdeDetalle() {
  const boton = $('#sheets-reconciliar');
  if (estado.sincronizando || estado.reconciliando) {
    mostrarEstadoSheets('aviso', 'Hay una sincronización en curso. Esperá a que termine y volvé a intentar.');
    return;
  }
  iniciarReconciliacion();
  const controles = [
    $('#sheets-reconciliar'),
    $('#sheets-enviar'),
    $('#sheets-traer'),
    $('#sheets-probar'),
  ].filter(Boolean);
  controles.forEach(control => { control.disabled = true; });
  boton.textContent = 'Comparando…';
  try {
    await guardarSheets();

    if (estado.clubesEnMutacion.size) {
      mostrarEstadoSheets('aviso',
        'Hay un escaneo o una edición local todavía en curso. Esperá a que termine y volvé a comparar.');
      return;
    }

    mostrarEstadoSheets('', 'Verificando clubes, columnas y fórmulas del molde…');
    const preparada = await sheets.preparar(
      $('#sheets-url').value.trim(),
      $('#sheets-clave').value,
      padronParaSheets(),
      eventosParaSheets()
    );
    if (!preparada.ok) {
      mostrarEstadoSheets('alerta', preparada.error || 'No se pudo verificar el molde de Puntajes.');
      return;
    }

    let remota = await traerDeSheets(true);
    if (!remota?.ok) {
      mostrarEstadoSheets('alerta', remota?.error || 'No se pudo leer Google Sheets.');
      return;
    }
    if (estado.versionSheets < 3
        || estado.revisionesDetalle.size < estado.puntajesHoja.size) {
      mostrarEstadoSheets('alerta',
        'Este control seguro requiere la API 3. Copiá la versión actual de ' +
        'herramientas/apps-script.gs y publicá una versión nueva del mismo despliegue.');
      return;
    }

    if (estado.pendientes.size) {
      mostrarEstadoSheets('', 'Primero se están enviando los cambios pendientes…');
      const enviada = await enviarClubes([...estado.pendientes], true);
      if (!enviada.ok) {
        mostrarEstadoSheets('alerta', enviada.error || 'No se pudieron enviar los cambios pendientes.');
        return;
      }
      if (estado.pendientes.size) {
        mostrarEstadoSheets('alerta',
          'Todavía hay cambios pendientes o en conflicto. Resolvelos antes de recalcular desde Detalle.');
        return;
      }
      remota = await traerDeSheets(true);
      if (!remota?.ok) {
        mostrarEstadoSheets('alerta', remota?.error || 'No se pudo verificar el envío pendiente.');
        return;
      }
    }

    const auditoria = auditarConsistenciaPuntajes();
    if (auditoria.clubesFaltantes.length || auditoria.eventosFaltantes.length) {
      mostrarEstadoSheets('alerta',
        'El molde sigue incompleto después de prepararlo. No se modificó ningún puntaje; ' +
        'revisá el Apps Script y volvé a intentar.');
      return;
    }
    const cantidadProblemas = cantidadProblemasAuditoria(auditoria);
    if (!cantidadProblemas) {
      mostrarEstadoSheets('ok',
        'Control aprobado: molde, Detalle, celdas de Puntajes y fórmulas TOTAL son consistentes.');
      pintarAvisoConsistencia();
      return;
    }

    const puestasEnCero = auditoria.diferencias
      .filter(d => d.local === 0 && d.remoto !== 0);
    if (sheets.detalleVacioEsDestructivo(estado.todos.length, auditoria.diferencias)) {
      mostrarEstadoSheets('alerta',
        `Detalle está vacío, pero Puntajes contiene ${puestasEnCero.length} celda(s) con valor. ` +
        'Por seguridad no se puso nada en cero. Revisá o restaurá Detalle en el historial de Google Sheets.');
      return;
    }

    const muestra = auditoria.diferencias.slice(0, 12)
      .map(d => `${d.idClub} ${d.codigo}: ${d.remoto} → ${d.local}`)
      .join('\n');
    const mas = auditoria.diferencias.length > 12
      ? `\n…y ${auditoria.diferencias.length - 12} diferencia(s) más.`
      : '';
    const mensaje =
      `Se encontraron ${auditoria.celdas} celda(s) diferentes y ` +
      `${auditoria.totalesIncorrectos.length} TOTAL(es) con valor o fórmula incorrectos.\n` +
      `${puestasEnCero.length} celda(s) quedarían en 0.\n\n` +
      `${muestra}${mas}\n\n` +
      '¿Reemplazar esas celdas con el puntaje calculado desde los QR de Detalle? ' +
      'Esto puede revertir correcciones manuales hechas directamente en Puntajes.';
    if (!confirm(mensaje)) {
      mostrarEstadoSheets('aviso', 'Comparación terminada sin modificar Google Sheets.');
      return;
    }
    if (puestasEnCero.length) {
      const clubes = new Set(puestasEnCero.map(d => d.idClub)).size;
      if (!confirm(
        `Confirmación de seguridad: ${puestasEnCero.length} celda(s) de ${clubes} club(es) ` +
        'pasarán a 0 porque no tienen respaldo válido en Detalle.\n\n¿Aplicar también esas reducciones?'
      )) {
        mostrarEstadoSheets('aviso', 'Comparación terminada sin aplicar las reducciones a cero.');
        return;
      }
    }

    const porClub = new Map();
    for (const diferencia of auditoria.diferencias) {
      if (!porClub.has(diferencia.idClub)) {
        porClub.set(diferencia.idClub, { eventos: {}, anteriores: {} });
      }
      const cambio = porClub.get(diferencia.idClub);
      cambio.eventos[diferencia.codigo] = diferencia.local;
      cambio.anteriores[diferencia.codigo] = diferencia.remoto;
    }
    // Un parche de cualquier celda válida vuelve a instalar la fórmula TOTAL de la fila.
    const codigoFormula = estado.eventosHoja[0]?.codigo || TODOS_LOS_ITEMS[0]?.codigo;
    for (const total of auditoria.totalesIncorrectos) {
      if (!codigoFormula) continue;
      if (!porClub.has(total.idClub)) {
        porClub.set(total.idClub, { eventos: {}, anteriores: {} });
      }
      const cambio = porClub.get(total.idClub);
      if (!(codigoFormula in cambio.eventos)) {
        const valor = Number(estado.puntajesHoja.get(total.idClub)?.eventos?.[codigoFormula]) || 0;
        cambio.eventos[codigoFormula] = valor;
        cambio.anteriores[codigoFormula] = valor;
      }
    }

    const cambios = [];
    for (const [idClub, cambio] of porClub) {
      const revisionDetalle = estado.revisionesDetalle.get(idClub);
      if (!revisionDetalle) {
        mostrarEstadoSheets('alerta',
          `No se recibió la huella de Detalle para ${idClub}. No se modificó ningún puntaje.`);
        return;
      }
      cambios.push({ idClub, ...cambio, revisionDetalle });
    }
    // Es un parche inmutable separado de la cola normal: nunca confirma ni borra
    // un QR que haya llegado mientras se realizaba la comparación.
    const reparada = await enviarReparacionesPuntajes(cambios);
    remota = await traerDeSheets(true);
    if (!remota?.ok) {
      mostrarEstadoSheets('alerta', remota?.error || 'No se pudo verificar la reparación.');
      return;
    }

    const final = auditarConsistenciaPuntajes();
    if (reparada.ok && !estado.pendientes.size && !cantidadProblemasAuditoria(final)) {
      mostrarEstadoSheets('ok',
        'Reparación verificada: molde, Detalle, Puntajes y fórmulas TOTAL ya coinciden.');
    } else {
      const conflictos = Array.isArray(reparada.conflictos) ? reparada.conflictos.length : 0;
      mostrarEstadoSheets('alerta',
        `Quedaron diferencias o ${conflictos} conflicto(s). Los cambios posteriores ` +
        'de Detalle se conservaron y no fueron sobrescritos; volvé a comparar.');
    }
    pintarAvisoConsistencia();
    pintarDiagnostico();
  } finally {
    terminarReconciliacion();
    if (estado.pendientes.size) programarSincronizacion();
    controles.forEach(control => { control.disabled = false; });
    boton.textContent = 'Comparar y recalcular desde Detalle';
  }
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

function solicitarDecisionCache() {
  const ids = [...estado.pendientes].filter(id => id !== CLUB_PRUEBA);
  const conjunto = new Set(ids);
  const cantidadEscaneos = estado.todos.filter(e => conjunto.has(e.idClub)).length;
  const nombres = ids.map(id => buscarClub(id)?.nombre || id);

  $('#conexion-configuracion').classList.add('oculto');
  $('#conexion-cache').classList.remove('oculto');
  $('#conexion-cache-resumen').textContent =
    `${ids.length} club${ids.length === 1 ? '' : 'es'} con cambios pendientes · ` +
    `${cantidadEscaneos} escaneo${cantidadEscaneos === 1 ? '' : 's'} guardado${cantidadEscaneos === 1 ? '' : 's'}.`;
  $('#conexion-cache-clubes').textContent = nombres.length
    ? `Clubes: ${nombres.join(', ')}.`
    : 'También hay cambios de estado de fichas pendientes.';
  for (const boton of $$('#conexion-cache button')) boton.disabled = false;

  return new Promise(resolver => {
    estado.resolverDecisionCache = resolver;
  });
}

function responderDecisionCache(decision) {
  if (!estado.resolverDecisionCache) return;
  for (const boton of $$('#conexion-cache button')) boton.disabled = true;
  const resolver = estado.resolverDecisionCache;
  estado.resolverDecisionCache = null;
  resolver(decision);
}

function restaurarFormularioConexion() {
  $('#conexion-cache').classList.add('oculto');
  $('#conexion-configuracion').classList.remove('oculto');
  for (const boton of $$('#conexion-cache button')) boton.disabled = false;
}

async function descartarCacheYAplicar(remota) {
  // La hoja es la fuente central: quitamos la copia de trabajo local completa y
  // acto seguido la reconstruimos con el estado remoto ya leído.
  await almacen.borrarTodo();
  estado.pendientes.clear();
  estado.eventosPendientes.clear();
  estado.revisionesPendientes.clear();
  await guardarPendientes();
  estado.todos = [];
  estado.fichas = new Map();
  estado.escaneos = [];
  estado.club = null;

  const aplicada = await aplicarEstadoRemoto(remota);
  if (!aplicada.ok) return aplicada;
  estado.fichas = await almacen.fichas();
  pintarClubes();
  pintarDiagnostico();
  return { ok: true };
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
  await asegurarUrlRevisionesDetalle(url);
  await almacen.guardarAjuste('sheetsUrl', url);
  await almacen.guardarAjuste('sheetsClave', clave);
  await almacen.guardarAjuste('dispositivo', dispositivo);

  // En la primera actualización de esta versión conservamos los datos locales y
  // los enviamos una vez. Después, Google Sheets queda como fuente central.
  const preparada = await almacen.leerAjuste('sincronizacionBidireccional', false);
  if (!preparada) {
    for (const idClub of new Set(estado.todos.map(e => e.idClub))) {
      if (!idClub || idClub === CLUB_PRUEBA) continue;
      registrarCambioPendiente(idClub);
      estado.pendientes.add(idClub);
    }
    await guardarPendientes();
  }

  let remota = await traerDeSheets(true);
  if (!remota?.ok && remota?.requierePreparacion) {
    mostrarEstadoConexion('', 'Creando el molde inicial de Google Sheets…');
    const inicializada = await sheets.preparar(
      url,
      clave,
      padronParaSheets(),
      eventosParaSheets()
    );
    if (inicializada.ok) remota = await traerDeSheets(true);
    else remota = inicializada;
  }
  if (!remota?.ok) {
    boton.disabled = false;
    boton.textContent = 'Conectar y sincronizar';
    mostrarEstadoConexion('alerta', remota?.error || 'No se pudo leer la planilla.');
    return;
  }

  // El Apps Script puede crear o migrar el molde sin perder valores existentes.
  // También repara columnas o clubes agregados después de la primera instalación.
  if (estado.versionSheets >= 2 && matrizNecesitaPreparacion()) {
    mostrarEstadoConexion('', 'Preparando clubes y columnas de eventos en Google Sheets…');
    const preparadaHoja = await sheets.preparar(
      url,
      clave,
      padronParaSheets(),
      eventosParaSheets()
    );
    if (!preparadaHoja.ok) {
      boton.disabled = false;
      boton.textContent = 'Conectar y sincronizar';
      mostrarEstadoConexion('alerta', preparadaHoja.error || 'No se pudo preparar la hoja Puntajes.');
      return;
    }
    remota = await traerDeSheets(true);
    if (!remota?.ok) {
      boton.disabled = false;
      boton.textContent = 'Conectar y sincronizar';
      mostrarEstadoConexion('alerta', remota?.error || 'La hoja se preparó, pero no se pudo volver a leer.');
      return;
    }
  }

  if (estado.pendientes.size) {
    $('#conexion-estado').innerHTML = '';
    const decision = await solicitarDecisionCache();

    if (decision === 'sin-conexion') {
      estado.conectado = false;
      restaurarFormularioConexion();
      $('#conexion-inicial').classList.add('oculto');
      mostrarEstadoSheets('aviso', 'Cambios locales conservados. Seguís trabajando sin conexión.');
      boton.disabled = false;
      boton.textContent = 'Conectar y sincronizar';
      return;
    }

    if (decision === 'descartar') {
      mostrarEstadoConexion('', 'Descartando la copia local y cargando Google Sheets…');
      const descartada = await descartarCacheYAplicar(remota);
      if (!descartada.ok) {
        restaurarFormularioConexion();
        boton.disabled = false;
        boton.textContent = 'Conectar y sincronizar';
        mostrarEstadoConexion('alerta', descartada.error || 'No se pudo reemplazar la copia local.');
        return;
      }
    } else {
      mostrarEstadoConexion('', 'Subiendo los cambios guardados en este teléfono…');
      const enviada = await enviarClubes([...estado.pendientes], true);
      if (!enviada.ok) {
        restaurarFormularioConexion();
        boton.disabled = false;
        boton.textContent = 'Conectar y sincronizar';
        mostrarEstadoConexion('alerta', enviada.error || 'No se pudieron enviar los datos locales.');
        return;
      }
      await traerDeSheets(true);
    }
  }

  await almacen.guardarAjuste('sincronizacionBidireccional', true);
  estado.conectado = true;
  iniciarIntervaloSincronizacion();
  restaurarFormularioConexion();
  $('#conexion-inicial').classList.add('oculto');
  mostrarEstadoSheets('ok', 'Conectado. La planilla se revisa automáticamente cada 20 segundos.');
  boton.disabled = false;
  boton.textContent = 'Conectar y sincronizar';
}

// ------------------------------------------------------------------ ajustes

async function pintarDiagnostico() {
  const seguro = window.isSecureContext;
  const todos = resultadosDeTodos();
  const auditoria = auditarConsistenciaPuntajes();
  const variosEvaluadores = clubesConVariosEvaluadores();
  const problemasPuntaje = cantidadProblemasAuditoria(auditoria);
  const lineas = [
    ['✅', 'Lectura de QR con la cámara',
      `Lector ${VERSION_LECTOR} · ${await Escaner.descripcionMotor()}`],
    [seguro ? '✅' : '❌', 'Contexto seguro (HTTPS)',
      seguro ? 'Sí, la cámara puede abrirse' : 'No. Sin HTTPS el navegador bloquea la cámara.'],
    ['📋', 'Clubes oficiales en el padrón', String(CLUBES_OFICIALES.length)],
    [estado.remotos.size ? '✅' : '⚠️', 'Stickers usados por otros clubes',
      estado.remotos.size
        ? `${estado.remotos.size}, traídos el ${new Date(estado.remotosFecha).toLocaleString('es-BO')}`
        : 'Sin traer. No se detectan stickers prestados entre clubes de otros evaluadores.'],
    [estado.conectado ? '✅' : '⚠️', 'Google Sheets',
      estado.conectado ? 'Conectado · actualización automática cada 20 segundos' : 'Sin conexión automática'],
    [!auditoria.disponible ? '➖' : problemasPuntaje ? '⚠️' : '✅',
      'Detalle ↔ Puntajes ↔ TOTAL',
      !auditoria.disponible
        ? 'Disponible después de conectar Google Sheets'
        : problemasPuntaje
          ? `${auditoria.celdas} celdas, ${auditoria.totalesIncorrectos.length} totales, ` +
            `${auditoria.clubesFaltantes.length} clubes y ${auditoria.eventosFaltantes.length} columnas por revisar`
          : 'Consistentes'],
    [variosEvaluadores.length ? '⚠️' : '✅', 'Un evaluador por club',
      variosEvaluadores.length
        ? `${variosEvaluadores.length} club(es) tienen escaneos con más de un nombre de evaluador`
        : 'Sin clubes compartidos entre teléfonos identificados'],
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
  const urlGuardada = await almacen.leerAjuste('sheetsUrl', '');
  const urlVigente = sheets.migrarUrlPredeterminada(urlGuardada);
  $('#sheets-url').value = urlVigente;
  if (urlVigente !== urlGuardada) await almacen.guardarAjuste('sheetsUrl', urlVigente);
  const revisionesGuardadas = await almacen.leerAjuste('revisionesDetalle', null);
  estado.revisionesDetalle = sheets.restaurarRevisionesDetalle(
    revisionesGuardadas,
    urlVigente
  );
  estado.urlRevisionesDetalle = urlVigente;
  $('#sheets-clave').value = await almacen.leerAjuste('sheetsClave', '') || '';
  $('#conexion-url').value = $('#sheets-url').value;
  $('#conexion-clave').value = $('#sheets-clave').value;
  $('#conexion-dispositivo').value = estado.dispositivo;

  const pendientes = await almacen.leerAjuste('clubesPendientes', []);
  if (Array.isArray(pendientes)) estado.pendientes = new Set(pendientes);
  const eventosPendientes = await almacen.leerAjuste('eventosPendientes', []);
  if (Array.isArray(eventosPendientes)) {
    estado.eventosPendientes = new Map(
      eventosPendientes.map(([id, codigos]) => [id, new Set(Array.isArray(codigos) ? codigos : [])])
    );
  }

  const remotos = await almacen.leerAjuste('remotos', null);
  if (Array.isArray(remotos)) estado.remotos = new Map(remotos);
  estado.remotosFecha = await almacen.leerAjuste('remotosFecha', null);
  const eventosHoja = await almacen.leerAjuste('eventosHoja', []);
  if (Array.isArray(eventosHoja)) estado.eventosHoja = sheets.normalizarEventos(eventosHoja);
  const puntajesHoja = await almacen.leerAjuste('puntajesHoja', []);
  if (Array.isArray(puntajesHoja)) estado.puntajesHoja = new Map(puntajesHoja);

  $('#filtro-region').innerHTML = '<option value="">Todas las regiones</option>' +
    [...new Set(CLUBES_OFICIALES.map(c => c.region))].filter(Boolean)
      .map(r => `<option>${escapar(r)}</option>`).join('');

  $('#m-fisicos .valor').textContent = `0/${CANTIDAD_EVENTOS_FISICOS}`;
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

  // Una recarga de la página vuelve a leer Sheets automáticamente cuando este
  // teléfono ya estaba configurado. No hacen falta websockets para ver lo último.
  if ($('#sheets-url').value.trim() && $('#sheets-clave').value) {
    await conectarInicial();
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
  if (texto) encolarCodigo(texto.trim());
});

// --- ficha
$('#cerrar-ficha').addEventListener('click', async () => {
  const idClub = estado.club.id;
  await duranteMutacionClub(idClub, async () => {
    const ficha = estado.fichas.get(idClub);
    await almacen.marcarFicha(idClub, { cerrada: !ficha?.cerrada });
    await marcarPendiente(idClub, []);
    estado.fichas = await almacen.fichas();
    if (estado.club?.id === idClub) pintarFicha();
    const ahoraCerrada = estado.fichas.get(idClub)?.cerrada;
    avisar(ahoraCerrada ? 'ok' : 'info', ahoraCerrada ? '🏁' : '📋',
      ahoraCerrada ? 'Ficha terminada' : 'Ficha reabierta',
      ahoraCerrada ? 'Podés pasar al siguiente club.' : 'Podés seguir escaneando.');
  });
});
$('#borrar-ficha').addEventListener('click', async () => {
  if (!confirm(`¿Borrar TODOS los escaneos de ${estado.club.nombre}? No se puede deshacer.`)) return;
  const idClub = estado.club.id;
  await duranteMutacionClub(idClub, async () => {
    const escaneosAntes = await almacen.escaneosDeClub(idClub);
    const antes = resultadoLocal(idClub, escaneosAntes);
    await almacen.borrarClub(idClub);
    estado.fichas = await almacen.fichas();
    const escaneosDespues = await recargarEscaneosDeClub(idClub);
    const despues = resultadoLocal(idClub, escaneosDespues);
    await marcarPendiente(idClub, codigosQueCambiaron(antes, despues));
    if (estado.club?.id === idClub) pintarFicha();
    avisar('info', '🗑️', 'Ficha vaciada', 'Podés empezar de nuevo.');
  });
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
$('#sheets-reconciliar').addEventListener('click', reconciliarPuntajesDesdeDetalle);
$('#conexion-conectar').addEventListener('click', conectarInicial);
$('#conexion-cache-subir').addEventListener('click', () => responderDecisionCache('subir'));
$('#conexion-cache-descartar').addEventListener('click', () => responderDecisionCache('descartar'));
$('#conexion-cache-sin-conexion').addEventListener('click', () => responderDecisionCache('sin-conexion'));
$('#conexion-omitir').addEventListener('click', () => {
  estado.conectado = false;
  $('#conexion-inicial').classList.add('oculto');
  mostrarEstadoSheets('aviso', 'Trabajando sin conexión. Podés conectarte desde Ajustes.');
});

$('#borrar-todo').addEventListener('click', async () => {
  if (!confirm('¿Borrar TODOS los datos de TODOS los clubes de este teléfono?')) return;
  if (!confirm('Esto no se puede deshacer. ¿Seguro?')) return;
  await esperarFinReconciliacion();
  const idsConDatos = [...new Set(estado.todos.map(e => e.idClub))];
  idsConDatos.forEach(iniciarMutacionClub);
  try {
    await conDatosExclusivos(async () => {
      await almacen.borrarTodo();
      estado.todos = []; estado.fichas = new Map(); estado.escaneos = [];
      for (const id of idsConDatos) {
        if (id === CLUB_PRUEBA) continue;
        agregarPendienteEnMemoria(id, TODOS_LOS_ITEMS.map(e => e.codigo));
      }
      await guardarPendientes();
    });
  } finally {
    idsConDatos.forEach(terminarMutacionClub);
  }
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
