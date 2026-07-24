// Catalogo de eventos y reglas de puntaje del campori.
//
// Este es el unico archivo que hay que tocar si cambian los eventos o los puntajes.
// Si cambias un codigo (F01, E03...) los stickers ya impresos dejan de coincidir,
// asi que agregá eventos nuevos al final en vez de renumerar los existentes.

export const CAMPORI = {
  prefijo: 'AV5',                    // compatibilidad con los QR antiguos
  nombre: 'Campori de Aventureros',
  // Solo se usa para seguir leyendo los QR firmados del formato anterior.
  clave: 'aventuri-2026-de-vuelta-a-casa',
};

export const PUNTOS_EVENTO = 200;

export const REGLAS = {
  // De los 14 fisicos disponibles cada club puede hacer 8. Si pegan mas,
  // valen los 8 primeros que escanea el evaluador y la ficha queda marcada.
  fisicosQueCuentan: 8,
  // Los 7 espirituales son obligatorios: si falta alguno, se avisa.
  espiritualesObligatorios: 7,
  // Cada evento adicional puede sumar una sola vez por club.
  adicionalesRepetibles: false,
  // Una misma sancion puede aplicarse varias veces (varios dias), asi que cada
  // sticker de sancion resta por separado. Lo que NO se permite es escanear el
  // mismo sticker dos veces: eso lo bloquea el control de serial ya escaneado.
  sancionesRepetibles: true,
  // El total nunca queda negativo: una sancion se come los puntos que el club
  // tenga y no mas. El detalle igual muestra cuanto se resto.
  pisoTotalEnCero: true,
};

export const EVENTOS_FISICOS = [
  { codigo: 'F01', nombre: 'Aventu acampante' },
  { codigo: 'F02', nombre: 'El traslado imposible' },
  { codigo: 'F03', nombre: 'El valde perforado' },
  { codigo: 'F04', nombre: 'Astronautas concentrados' },
  { codigo: 'F05', nombre: 'Transportando agua a Marte' },
  { codigo: 'F06', nombre: 'Misión espacial' },
  { codigo: 'F07', nombre: 'Entrenamiento de astronautas' },
  { codigo: 'F08', nombre: 'Estrella espacial' },
  { codigo: 'F09', nombre: 'Jugando con el Ula Ula' },
  { codigo: 'F10', nombre: 'La canasta de los planetas' },
  { codigo: 'F11', nombre: 'El astronauta en la Luna' },
  { codigo: 'F12', nombre: 'Astronautas rumbo a casa' },
  { codigo: 'F13', nombre: 'Rescate en el espacio: La Salvación' },
  { codigo: 'F14', nombre: 'Ojos en el centro de control' },
];

export const EVENTOS_ESPIRITUALES = [
  { codigo: 'E01', nombre: 'Los libros de la Biblia a la velocidad de la luz' },
  { codigo: 'E02', nombre: 'Apuntando al cielo' },
  { codigo: 'E03', nombre: 'Cadena cósmica conectados por la Fe' },
  { codigo: 'E04', nombre: 'Jesús es nuestro guía para volver al hogar' },
  { codigo: 'E05', nombre: 'Aprendiendo mas de Jesús' },
  { codigo: 'E06', nombre: 'Un salto a la nueva Jerusalen' },
  { codigo: 'E07', nombre: 'La Ley del Aventureros' },
];

// Eventos adicionales oficiales. Todos valen 100 puntos y cuentan una sola vez.
export const CRITERIOS_ADICIONALES = [
  { codigo: 'A01', nombre: 'RFA VIERNES', puntos: 100 },
  { codigo: 'A02', nombre: 'CULTO GENERAL VIERNES MAÑANA', puntos: 100 },
  { codigo: 'A03', nombre: 'RECEPCIÓN DE SÁBADO', puntos: 100 },
  { codigo: 'A04', nombre: 'CULTO GENERAL VIERNES NOCHE', puntos: 100 },
  { codigo: 'A05', nombre: 'SUPER PAPÁ SUPER MAMÁ', puntos: 100 },
  { codigo: 'A06', nombre: 'SUPER PAPÁ SUPER MAMÁ SEGUNDA FASE', puntos: 100 },
  { codigo: 'A07', nombre: 'AVENTURALLY', puntos: 100 },
  { codigo: 'A08', nombre: 'CULTO DIVINO', puntos: 100 },
  { codigo: 'A09', nombre: 'ESCUELA SABÁTICA', puntos: 100 },
  { codigo: 'A10', nombre: 'UNIFORMES CAMPING', puntos: 100 },
  { codigo: 'A11', nombre: 'SÁBADO EN LA TARDE', puntos: 100 },
  { codigo: 'A12', nombre: 'SUPER PAPÁ SUPER MAMÁ FASE FINAL', puntos: 100 },
  { codigo: 'A13', nombre: 'BUENO CON LA BIBLIA', puntos: 100 },
  { codigo: 'A14', nombre: 'STAND 1', puntos: 100 },
  { codigo: 'A15', nombre: 'STAND 2', puntos: 100 },
  { codigo: 'A16', nombre: 'STAND 3', puntos: 100 },
  { codigo: 'A17', nombre: 'STAND 4', puntos: 100 },
  { codigo: 'A18', nombre: 'STAND 5', puntos: 100 },
  { codigo: 'A19', nombre: 'BUENO CON LA BIBLIA SEGUNDA FASE', puntos: 100 },
  { codigo: 'A20', nombre: 'RFA SÁBADO', puntos: 100 },
  { codigo: 'A21', nombre: 'BUENO CON LA BIBLIA FASE FINAL', puntos: 100 },
  { codigo: 'A22', nombre: 'STAND 6', puntos: 100 },
  { codigo: 'A23', nombre: 'CAMPAMENTO LIMPIO', puntos: 100 },
  { codigo: 'A24', nombre: 'ESPECIALIDAD 1', puntos: 100 },
  { codigo: 'A25', nombre: 'ESPECIALIDAD 2', puntos: 100 },
  { codigo: 'A26', nombre: 'ESPECIALIDAD 3', puntos: 100 },
  { codigo: 'A27', nombre: 'EVENTO DIRECTORES', puntos: 100 },
  { codigo: 'A28', nombre: 'INSPECCIÓN SÁBADO', puntos: 100 },
  { codigo: 'A29', nombre: 'VOLEYBALL GIGANTE', puntos: 100 },
  // Eventos agregados despues. Van al final para no renumerar los anteriores, y
  // pueden tener puntajes distintos de 100: el motor lee el valor de cada uno.
  { codigo: 'A30', nombre: 'BOTIQUÍN', puntos: 500 },
  { codigo: 'A31', nombre: 'PLAZA DEL AVENTURERO', puntos: 200 },
  { codigo: 'A32', nombre: 'SEGURIDAD', puntos: 200 },
  { codigo: 'A33', nombre: 'LIMPIEZA KM4', puntos: 200 },
];

// Sanciones: restan puntaje. Cada una tiene puntos negativos y su propio QR.
// Se pegan en la ficha del club igual que cualquier sticker; al escanearlas,
// descuentan del total (que nunca baja de 0, ver REGLAS.pisoTotalEnCero).
export const SANCIONES = [
  { codigo: 'S01', nombre: 'Infringir el Sábado', puntos: -2000 },
  { codigo: 'S02', nombre: 'No clasificar la basura', puntos: -500 },
  { codigo: 'S03', nombre: 'No respetar la hora de silencio', puntos: -500 },
];

// ------------------------------------------------------------------ derivados

export const TOPE_FISICO = REGLAS.fisicosQueCuentan * PUNTOS_EVENTO;        // 1600
export const TOPE_ESPIRITUAL = REGLAS.espiritualesObligatorios * PUNTOS_EVENTO; // 1400
export const TOPE_BASE = TOPE_FISICO + TOPE_ESPIRITUAL;                     // 3000

const porCodigo = new Map();
for (const e of EVENTOS_FISICOS) porCodigo.set(e.codigo, { ...e, tipo: 'fisico', puntos: PUNTOS_EVENTO });
for (const e of EVENTOS_ESPIRITUALES) porCodigo.set(e.codigo, { ...e, tipo: 'espiritual', puntos: PUNTOS_EVENTO });
for (const e of CRITERIOS_ADICIONALES) porCodigo.set(e.codigo, { ...e, tipo: 'adicional' });
for (const e of SANCIONES) porCodigo.set(e.codigo, { ...e, tipo: 'sancion' });

export const TODOS_LOS_ITEMS = [...porCodigo.values()];

export function buscarEvento(codigo) {
  return porCodigo.get(codigo) || null;
}

export function etiquetaTipo(tipo) {
  return { fisico: 'Físico', espiritual: 'Espiritual', adicional: 'Adicional', sancion: 'Sanción' }[tipo] || tipo;
}
