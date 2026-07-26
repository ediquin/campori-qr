// Motor de puntaje: convierte una lista de escaneos en el resultado de un club.
//
// Es una funcion pura, sin estado ni acceso al almacenamiento. Toda la app (la pantalla
// de escaneo, el resumen y la exportacion a Excel) llama a esta misma funcion, asi que
// no hay forma de que muestren numeros distintos.

import {
  REGLAS, PUNTOS_EVENTO, TOPE_FISICO, TOPE_ESPIRITUAL,
  CANTIDAD_EVENTOS_FISICOS, EVENTOS_ESPIRITUALES, buscarEvento, etiquetaTipo,
} from './catalogo.js';
import { leerQr } from './codigo.js';

// Un escaneo se descarta o se cuenta, y el motivo tiene que quedar visible para el
// evaluador. Estos son todos los desenlaces posibles.
export const ESTADOS = {
  contado: { etiqueta: 'Contado', nivel: 'ok' },
  club: { etiqueta: 'QR de club', nivel: 'info' },
  repetido: { etiqueta: 'Evento repetido', nivel: 'alerta' },
  serial_repetido: { etiqueta: 'Sticker ya escaneado', nivel: 'alerta' },
  serial_ajeno: { etiqueta: 'Sticker de otro club', nivel: 'alerta' },
  desconocido: { etiqueta: 'Evento fuera del catálogo', nivel: 'alerta' },
  invalido: { etiqueta: 'QR inválido', nivel: 'alerta' },
  // Un nivel de una rubrica (p. ej. Botiquin) que quedo desplazado por otro de mayor
  // puntaje del mismo grupo. No suma, y se marca como error para revisar el cruce.
  desplazado: { etiqueta: 'Nivel desplazado (rúbrica)', nivel: 'alerta' },
};

/**
 * @param {Array} escaneos  en el orden en que se escanearon. Cada uno: { crudo, ts }
 * @param {Object} opciones
 *   - usadosPorOtros: Map id de sticker -> id de club que ya lo uso.
 * @returns resultado completo del club
 */
export function calcular(escaneos, opciones = {}) {
  const { usadosPorOtros = null } = opciones;

  const detalle = [];
  const alertas = [];
  const serialesVistos = new Map();   // id de sticker -> posicion del escaneo
  const eventosContados = new Map();  // codigo de evento -> posicion del escaneo
  const contados = { fisico: [], espiritual: [], adicional: [], sancion: [] };

  escaneos.forEach((escaneo, i) => {
    const anotar = (estado, extra = {}) => {
      detalle.push({ orden: i + 1, escaneo, estado, puntos: 0, ...extra });
    };

    const lectura = leerQr(escaneo.crudo);
    if (!lectura.ok) {
      anotar('invalido', { detalleTexto: lectura.detalle || 'No se pudo leer' });
      return;
    }
    if (lectura.clase === 'club') {
      anotar('club', { idClub: lectura.idClub, detalleTexto: 'Identifica la ficha, no suma puntos' });
      return;
    }

    const evento = buscarEvento(lectura.codigo);
    if (!evento) {
      anotar('desconocido', { detalleTexto: `El código ${lectura.codigo} no está en el catálogo` });
      return;
    }

    // El mismo sticker fisico escaneado dos veces en esta ficha.
    if (serialesVistos.has(lectura.id)) {
      anotar('serial_repetido', {
        evento,
        detalleTexto: `Ya se escaneó en la posición ${serialesVistos.get(lectura.id)}`,
      });
      return;
    }
    serialesVistos.set(lectura.id, i + 1);

    // El mismo sticker aparece en la ficha de otro club: alguien lo despegó o lo presto.
    const duenoPrevio = usadosPorOtros?.get(lectura.id);
    if (duenoPrevio) {
      anotar('serial_ajeno', { evento, detalleTexto: `Ya fue usado por el club ${duenoPrevio}` });
      return;
    }

    // Las sanciones y los eventos marcados como repetibles pueden aparecer varias
    // veces. Lo que no se permite es el mismo sticker dos veces, y eso ya lo bloqueó
    // el control de serial de más arriba.
    const yaContado = eventosContados.get(evento.codigo);
    const puedeRepetir = evento.repetible === true ||
                         (evento.tipo === 'adicional' && REGLAS.adicionalesRepetibles) ||
                         (evento.tipo === 'sancion' && REGLAS.sancionesRepetibles);
    if (yaContado && !puedeRepetir) {
      anotar('repetido', {
        evento,
        detalleTexto: `"${evento.nombre}" ya se contó en la posición ${yaContado}`,
      });
      return;
    }

    // El sticker trae su puntaje impreso. Si no coincide con el catalogo actual es
    // que se imprimio con otra configuracion: mandamos el del catalogo y avisamos.
    // Fisicos y espirituales valen siempre PUNTOS_EVENTO; adicionales y sanciones
    // toman su valor del catalogo (los adicionales pueden ser 100/200/500, las
    // sanciones son negativas).
    const puntosCatalogo = (evento.tipo === 'adicional' || evento.tipo === 'sancion')
      ? evento.puntos
      : PUNTOS_EVENTO;
    if (Number.isInteger(lectura.puntos) && lectura.puntos !== puntosCatalogo) {
      alertas.push({
        nivel: 'aviso',
        texto: `El sticker de "${evento.nombre}" dice ${lectura.puntos} pts pero el catálogo indica ${puntosCatalogo}. Se usó ${puntosCatalogo}.`,
      });
    }

    if (!yaContado) eventosContados.set(evento.codigo, i + 1);
    contados[evento.tipo].push({ evento, puntos: puntosCatalogo, orden: i + 1 });
    anotar('contado', { evento, puntos: puntosCatalogo });
  });

  // ------------------------------------------------------------ rubricas
  // Algunos eventos son niveles de una misma rubrica (p. ej. los tres de Botiquin):
  // el club recibe UNO solo. Si aparecen varios, cuenta el de mayor puntaje y los
  // demas quedan desplazados. Es un error operativo (el juez pego dos niveles), asi
  // que se marca como alerta grave para que el equipo lo revise y lo aclare.
  const porRubrica = new Map();
  for (const c of contados.adicional) {
    if (!c.evento.rubrica) continue;
    if (!porRubrica.has(c.evento.rubrica)) porRubrica.set(c.evento.rubrica, []);
    porRubrica.get(c.evento.rubrica).push(c);
  }
  for (const items of porRubrica.values()) {
    if (items.length < 2) continue;
    // Gana el de mayor puntaje; si empatan, el que se escaneo primero.
    items.sort((a, b) => b.puntos - a.puntos || a.orden - b.orden);
    const [ganador, ...perdedores] = items;
    const perdedoresSet = new Set(perdedores);
    contados.adicional = contados.adicional.filter(c => !perdedoresSet.has(c));
    for (const p of perdedores) {
      const d = detalle.find(x => x.orden === p.orden);
      if (d) {
        d.estado = 'desplazado';
        d.puntos = 0;
        d.detalleTexto = `No suma: ya cuenta "${ganador.evento.nombre}" (${ganador.puntos} pts) del mismo grupo`;
      }
    }
    const nombres = perdedores.map(p => `"${p.evento.nombre}"`).join(', ');
    alertas.push({
      nivel: 'alerta',
      texto: `REVISAR — el club tiene ${items.length} niveles de la misma rúbrica pegados. ` +
             `Cuenta solo "${ganador.evento.nombre}" (${ganador.puntos} pts); se ignoró ${nombres}. Aclarar el cruce.`,
    });
  }

  const sumar = lista => lista.reduce((t, x) => t + x.puntos, 0);
  const puntosFisico = sumar(contados.fisico);
  const puntosEspiritual = sumar(contados.espiritual);
  const puntosAdicional = sumar(contados.adicional);
  const puntosSancion = sumar(contados.sancion);   // negativo o cero

  const codigosEspiritualesHechos = new Set(contados.espiritual.map(x => x.evento.codigo));
  const espiritualesFaltantes = EVENTOS_ESPIRITUALES.filter(e => !codigosEspiritualesHechos.has(e.codigo));

  // ------------------------------------------------------------ alertas

  if (espiritualesFaltantes.length) {
    alertas.push({
      nivel: 'aviso',
      texto: `Faltan ${espiritualesFaltantes.length} de ${REGLAS.espiritualesObligatorios} eventos espirituales obligatorios: ` +
             espiritualesFaltantes.map(e => e.nombre).join(', '),
    });
  }
  // Las sanciones se muestran como alerta grave: es lo que el jurado tiene que ver.
  if (contados.sancion.length) {
    const detalleSanciones = contados.sancion
      .map(s => `${s.evento.nombre} (${s.puntos})`).join(', ');
    alertas.push({
      nivel: 'alerta',
      texto: `${contados.sancion.length} sanción${contados.sancion.length === 1 ? '' : 'es'} ` +
             `por ${puntosSancion} pts: ${detalleSanciones}.`,
    });
  }
  for (const d of detalle) {
    if (['repetido', 'serial_repetido', 'serial_ajeno', 'desconocido', 'invalido'].includes(d.estado)) {
      const nombre = d.evento ? `"${d.evento.nombre}"` : d.escaneo.crudo;
      alertas.push({
        nivel: ESTADOS[d.estado].nivel,
        texto: `Escaneo ${d.orden} — ${ESTADOS[d.estado].etiqueta}: ${nombre}. ${d.detalleTexto || ''}`.trim(),
      });
    }
  }

  // Lo grave primero. Un sticker robado no puede quedar debajo del aviso rutinario
  // de "faltan espirituales", que le aparece a casi todas las fichas a medio evaluar.
  const gravedad = { alerta: 0, aviso: 1, info: 2 };
  alertas.sort((a, b) => (gravedad[a.nivel] ?? 3) - (gravedad[b.nivel] ?? 3));

  return {
    fisico: {
      puntos: puntosFisico,
      tope: TOPE_FISICO,
      hechos: contados.fisico.length,
      cupo: CANTIDAD_EVENTOS_FISICOS,
      minimoParaCompletar: REGLAS.fisicosMinimosParaCompletar,
      eventos: contados.fisico,
    },
    espiritual: {
      puntos: puntosEspiritual,
      tope: TOPE_ESPIRITUAL,
      hechos: contados.espiritual.length,
      cupo: REGLAS.espiritualesObligatorios,
      faltantes: espiritualesFaltantes,
      eventos: contados.espiritual,
    },
    adicional: {
      puntos: puntosAdicional,
      eventos: contados.adicional,
    },
    sancion: {
      puntos: puntosSancion,          // negativo o cero
      cantidad: contados.sancion.length,
      eventos: contados.sancion,
    },
    // El total suma todo y despues se pone un piso en cero (REGLAS.pisoTotalEnCero):
    // una sancion se come los puntos que el club tenga, pero no lo deja negativo.
    // `totalBruto` conserva la resta real por si hace falta auditarla.
    totalBruto: puntosFisico + puntosEspiritual + puntosAdicional + puntosSancion,
    total: pisar(puntosFisico + puntosEspiritual + puntosAdicional + puntosSancion),
    totalBase: puntosFisico + puntosEspiritual,
    detalle,
    alertas,
    completo: espiritualesFaltantes.length === 0
      && contados.fisico.length >= REGLAS.fisicosMinimosParaCompletar,
  };
}

// Aplica el piso del total. Con REGLAS.pisoTotalEnCero el total nunca baja de 0.
function pisar(total) {
  return REGLAS.pisoTotalEnCero ? Math.max(0, total) : total;
}

/** Resumen de una linea para listados y para la planilla. */
export function resumen(resultado) {
  return {
    fisico: resultado.fisico.puntos,
    espiritual: resultado.espiritual.puntos,
    adicional: resultado.adicional.puntos,
    sancion: resultado.sancion.puntos,
    total: resultado.total,
    eventosFisicos: resultado.fisico.hechos,
    eventosEspirituales: resultado.espiritual.hechos,
    sanciones: resultado.sancion.cantidad,
    alertas: resultado.alertas.length,
    completo: resultado.completo,
  };
}

export { etiquetaTipo };
