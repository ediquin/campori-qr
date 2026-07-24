// Catalogo de eventos y reglas de puntaje del campori.
//
// Este es el unico archivo que hay que tocar si cambian los eventos o los puntajes.
// Si cambias un codigo (F01, E03...) los stickers ya impresos dejan de coincidir,
// asi que agregá eventos nuevos al final en vez de renumerar los existentes.

export const CAMPORI = {
  prefijo: 'AV5',                    // va en cada QR; distingue estos stickers de cualquier otro
  nombre: 'Campori de Aventureros',
  // Clave de firma de los QR. Cambiala por una propia ANTES de imprimir los stickers.
  // No es secreto militar: evita que alguien genere un QR valido con el celular,
  // pero la defensa real es el inventario de seriales (ver js/codigo.js).
  clave: 'aventuri-2026-de-vuelta-a-casa',
};

export const PUNTOS_EVENTO = 200;

export const REGLAS = {
  // De los 14 fisicos disponibles cada club puede hacer 8. Si pegan mas,
  // valen los 8 primeros que escanea el evaluador y la ficha queda marcada.
  fisicosQueCuentan: 8,
  // Los 7 espirituales son obligatorios: si falta alguno, se avisa.
  espiritualesObligatorios: 7,
  // Un mismo criterio adicional puede sumar mas de una vez (ej. limpieza revisada
  // cada dia). Poné false si querés que cada criterio sume una sola vez por club.
  adicionalesRepetibles: true,
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

// PROVISORIO: estos criterios son de ejemplo para que el sistema quede armado.
// Reemplazalos por los reales antes de imprimir. Los puntos solo pueden ser 100 o 50.
export const CRITERIOS_ADICIONALES = [
  { codigo: 'A01', nombre: 'Limpieza de baños', puntos: 100 },
  { codigo: 'A02', nombre: 'Seguridad del campamento', puntos: 100 },
  { codigo: 'A03', nombre: 'Orden y limpieza del sitio', puntos: 100 },
  { codigo: 'A04', nombre: 'Puntualidad', puntos: 50 },
  { codigo: 'A05', nombre: 'Uniforme completo', puntos: 50 },
  { codigo: 'A06', nombre: 'Decoración de la carpa', puntos: 50 },
];

// ------------------------------------------------------------------ derivados

export const TOPE_FISICO = REGLAS.fisicosQueCuentan * PUNTOS_EVENTO;        // 1600
export const TOPE_ESPIRITUAL = REGLAS.espiritualesObligatorios * PUNTOS_EVENTO; // 1400
export const TOPE_BASE = TOPE_FISICO + TOPE_ESPIRITUAL;                     // 3000

const porCodigo = new Map();
for (const e of EVENTOS_FISICOS) porCodigo.set(e.codigo, { ...e, tipo: 'fisico', puntos: PUNTOS_EVENTO });
for (const e of EVENTOS_ESPIRITUALES) porCodigo.set(e.codigo, { ...e, tipo: 'espiritual', puntos: PUNTOS_EVENTO });
for (const e of CRITERIOS_ADICIONALES) porCodigo.set(e.codigo, { ...e, tipo: 'adicional' });

export const TODOS_LOS_ITEMS = [...porCodigo.values()];

export function buscarEvento(codigo) {
  return porCodigo.get(codigo) || null;
}

export function etiquetaTipo(tipo) {
  return { fisico: 'Físico', espiritual: 'Espiritual', adicional: 'Adicional' }[tipo] || tipo;
}
