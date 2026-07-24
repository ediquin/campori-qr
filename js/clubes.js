// Padron de clubes del Campori de Aventureros.
//
// ARCHIVO GENERADO -- no lo edites a mano.
// Fuente: "LISTAS GENERALES.xlsx", hoja "BASE DE DATOS".
// Esa planilla tiene una fila por comprobante de pago (165 filas), no por club;
// aca ya vienen deduplicados y con el nombre unificado: 71 clubes reales.
//
// No incluye el nombre de los directores a proposito: este archivo termina publicado
// y son datos personales. El club se identifica igual con su nombre, region e iglesia.
// Si los necesitás en la ficha impresa:  node herramientas/generar-clubes.mjs --con-directores
//
// Para regenerarlo:  node herramientas/generar-clubes.mjs

export const CLUBES = [
  { id: 'C001', nombre: 'Aziel Calacoto Jr.', region: 'Región 1', iglesia: 'Calacoto', distrito: 'Calacoto' },
  { id: 'C002', nombre: 'Gerizim', region: 'Región 1', iglesia: 'Jupapina', distrito: 'La Paz El Valle' },
  { id: 'C003', nombre: 'Lemuel', region: 'Región 1', iglesia: 'Chasquipampa', distrito: 'Chasquipampa' },
  { id: 'C004', nombre: 'Yare', region: 'Región 1', iglesia: 'Mallasa', distrito: 'La Paz El Valle' },
  { id: 'C005', nombre: 'Alfa Omega', region: 'Región 2', iglesia: 'Villa Nuevo Potosi', distrito: 'Villa Nueva Potosi' },
  { id: 'C006', nombre: 'IALA', region: 'Región 2', iglesia: 'IALA', distrito: 'San Pedro' },
  { id: 'C007', nombre: 'PENIEL', region: 'Región 2', iglesia: 'Bello Horizonte', distrito: 'Bello Horizonte' },
  { id: 'C008', nombre: 'Chicani', region: 'Región 3', iglesia: 'Chicani', distrito: 'Kupini' },
  { id: 'C009', nombre: 'ESCUDERITOS', region: 'Región 3', iglesia: 'Escobar Uria', distrito: 'Villa Copacabana' },
  { id: 'C010', nombre: 'Fenix', region: 'Región 3', iglesia: 'Congregación HOREB', distrito: 'Kupini' },
  { id: 'C011', nombre: 'Kids Fortaleza', region: 'Región 3', iglesia: 'Kupini', distrito: 'Kupini' },
  { id: 'C012', nombre: 'Pampahasi Jr.', region: 'Región 3', iglesia: 'Pampahasi', distrito: 'Pampahasi' },
  { id: 'C013', nombre: 'Villa Salomé', region: 'Región 3', iglesia: 'Villa Salomé', distrito: 'Pampahasi' },
  { id: 'C014', nombre: 'Yasser kids', region: 'Región 3', iglesia: 'San Juan', distrito: 'Pampahasi' },
  { id: 'C015', nombre: 'Ad Venir Kids', region: 'Región 4', iglesia: 'Miraflores', distrito: 'Miraflores' },
  { id: 'C016', nombre: 'Bet-el', region: 'Región 4', iglesia: 'San Antonio Bajo', distrito: 'Alto Miraflores' },
  { id: 'C017', nombre: 'Ch\'itis Eternal Cam', region: 'Región 4', iglesia: 'Alto Miraflores', distrito: 'Alto Miraflores' },
  { id: 'C018', nombre: 'Lucerito', region: 'Región 4', iglesia: 'Filial Shalom', distrito: 'Miraflores' },
  { id: 'C019', nombre: 'MANITOS DE JIREH', region: 'Región 4', iglesia: 'CHUQUIAGUILLO', distrito: 'Villa El Carmen' },
  { id: 'C020', nombre: 'SHADAI', region: 'Región 4', iglesia: 'Villa Fátima', distrito: 'Villa Fatima' },
  { id: 'C021', nombre: 'Soldaditos de Gedeon', region: 'Región 4', iglesia: 'La Merced', distrito: 'Villa Fatima' },
  { id: 'C022', nombre: 'AETOS', region: 'Región 5', iglesia: 'La Portada', distrito: 'La Portada' },
  { id: 'C023', nombre: 'Áncora Kids', region: 'Región 5', iglesia: 'Alto vino tinto', distrito: 'Central La Paz' },
  { id: 'C024', nombre: 'Central', region: 'Región 5', iglesia: 'Central', distrito: 'Central La Paz' },
  { id: 'C025', nombre: 'Jireh NLP', region: 'Región 5', iglesia: 'Alto Ciudadela', distrito: 'Norte La Paz' },
  { id: 'C026', nombre: 'Los Andes', region: 'Región 5', iglesia: 'Los Andes', distrito: 'Los Andes' },
  { id: 'C027', nombre: 'Messenger', region: 'Región 5', iglesia: 'Panticirca', distrito: 'Norte La Paz' },
  { id: 'C028', nombre: 'Munich-7', region: 'Región 5', iglesia: 'Munaypata', distrito: 'La Portada' },
  { id: 'C029', nombre: 'RAHAM', region: 'Región 5', iglesia: 'PURA PURA', distrito: 'Norte La Paz' },
  { id: 'C030', nombre: 'De lo Alto', region: 'Región 6', iglesia: 'Ciudad Satélite', distrito: 'Villa Tejada' },
  { id: 'C031', nombre: 'Eliel', region: 'Región 6', iglesia: 'Villa exaltacion', distrito: 'Villa Tejada' },
  { id: 'C032', nombre: 'ELNATAN', region: 'Región 6', iglesia: 'LA CEJA', distrito: '12 de Octubre' },
  { id: 'C033', nombre: 'Halcones', region: 'Región 6', iglesia: 'Pucarani achocalla', distrito: 'Achocalla' },
  { id: 'C034', nombre: 'León de Juda', region: 'Región 6', iglesia: 'Villa Dolores', distrito: 'Villa Dolores' },
  { id: 'C035', nombre: 'Mensajeritos de Alpacoma', region: 'Región 6', iglesia: 'Congregacion Alpacoma', distrito: 'Villa Tejada' },
  { id: 'C036', nombre: 'Nayriri', region: 'Región 6', iglesia: 'Pacajes Achocalla', distrito: 'Achocalla' },
  { id: 'C037', nombre: 'Torre Fuerte', region: 'Región 6', iglesia: '12 de Octubre', distrito: '12 de Octubre' },
  { id: 'C038', nombre: 'Vencedores JR', region: 'Región 6', iglesia: 'Marquirivi', distrito: 'Achocalla' },
  { id: 'C039', nombre: 'Yahve Jireh', region: 'Región 6', iglesia: 'Villa Tejada', distrito: 'Villa Tejada' },
  { id: 'C040', nombre: 'Adonay', region: 'Región 7', iglesia: 'Huayna Potosí', distrito: 'Huayna Potosí' },
  { id: 'C041', nombre: 'Adriel', region: 'Región 7', iglesia: 'Villa tunari', distrito: '16 de Julio' },
  { id: 'C042', nombre: 'ALDEBARÁN', region: 'Región 7', iglesia: 'Nueva marca', distrito: '16 de Julio' },
  { id: 'C043', nombre: 'Almagor', region: 'Región 7', iglesia: 'Sur Ballivian', distrito: 'Sur Ballivián' },
  { id: 'C044', nombre: 'ARMAGEDÓN', region: 'Región 7', iglesia: 'VILLA BALLIVIAN', distrito: 'Villa Ballivian' },
  { id: 'C045', nombre: 'Pioneros', region: 'Región 7', iglesia: 'Alto lima', distrito: 'Huayna Potosí' },
  { id: 'C046', nombre: 'Pioneros del Oeste', region: 'Región 7', iglesia: '16 de julio', distrito: '16 de Julio' },
  { id: 'C047', nombre: 'Victoriosos Kids', region: 'Región 7', iglesia: 'Victoria en Cristo', distrito: '16 de Julio' },
  { id: 'C048', nombre: 'ZURISADAI', region: 'Región 7', iglesia: 'San Francisco', distrito: 'Huayna Potosí' },
  { id: 'C049', nombre: 'Altair BSR', region: 'Región 8', iglesia: 'Herederos de Cristo', distrito: 'San José' },
  { id: 'C050', nombre: 'Arbel', region: 'Región 8', iglesia: 'Achacahi', distrito: 'Achacachi Escoma' },
  { id: 'C051', nombre: 'ELYON', region: 'Región 8', iglesia: 'IASD LA ESPERANZA ES JESÚS', distrito: 'Rio Seco' },
  { id: 'C052', nombre: 'Emmanuel', region: 'Región 8', iglesia: 'Río Seco', distrito: 'Rio Seco' },
  { id: 'C053', nombre: 'Guardianes', region: 'Región 8', iglesia: 'Bautista Savedra', distrito: 'Bautista Saavedra' },
  { id: 'C054', nombre: 'Haverin', region: 'Región 8', iglesia: 'San Roque', distrito: 'San Roque' },
  { id: 'C055', nombre: 'JHILEAH', region: 'Región 8', iglesia: 'Villa Ingenio', distrito: 'Villa Ingenio' },
  { id: 'C056', nombre: 'Medley', region: 'Región 8', iglesia: 'San José', distrito: 'San José' },
  { id: 'C057', nombre: 'Soldaditos abdiel', region: 'Región 8', iglesia: 'San Felipe de seque', distrito: 'Rio Seco' },
  { id: 'C058', nombre: 'Soldaditos Agamenón', region: 'Región 8', iglesia: '16 de Febrero', distrito: 'San José' },
  { id: 'C059', nombre: 'Angelos Kids', region: 'Región 9', iglesia: 'Caranavi Sur', distrito: 'Caranavi Sur' },
  { id: 'C060', nombre: 'Ashito shammoa', region: 'Región 9', iglesia: 'Caranavi central', distrito: 'Caranavi' },
  { id: 'C061', nombre: 'Orion Kids', region: 'Región 9', iglesia: 'La Reserva', distrito: 'Carrasco' },
  { id: 'C062', nombre: 'Centinelas de san Borja', region: 'Región 10', iglesia: 'Villa aroma', distrito: 'Yucumo' },
  { id: 'C063', nombre: 'Club Bethel Kids', region: 'Región 10', iglesia: 'Yucumo', distrito: 'Yucumo' },
  { id: 'C064', nombre: 'Livingstone Kids', region: 'Región 10', iglesia: 'San Borja', distrito: 'San Borja' },
  { id: 'C065', nombre: 'Palos Blancos jr', region: 'Región 10', iglesia: 'Palos blancos', distrito: 'Palos Blancos' },
  { id: 'C066', nombre: 'PEQUEÑOS CENTINELAS', region: 'Región 10', iglesia: 'RURRENABAQUE', distrito: 'Rurrenabaque' },
  { id: 'C067', nombre: 'Coroico kids', region: 'Región 11', iglesia: 'Coroico', distrito: 'Coroico' },
  { id: 'C068', nombre: 'Excelsus Kids', region: 'Región 11', iglesia: 'Chicaloma', distrito: 'Irupana' },
  { id: 'C069', nombre: 'Obreritos de Irupana', region: 'Región 11', iglesia: 'Irupana', distrito: 'Irupana' },
  { id: 'C070', nombre: '+ Q VENCEDORES', region: 'Región 12', iglesia: 'Asunta Central', distrito: 'La Asunta "A"' },
  { id: 'C071', nombre: 'Yaguaras Jr', region: 'Región 13', iglesia: 'Sena', distrito: 'Amazonía' },
  // Club de prueba. No participa del campori: sirve para ensayar la app sin ensuciar datos reales.
  { id: 'C999', nombre: 'ediquin', region: 'PRUEBA', iglesia: 'Club de prueba', distrito: 'Pruebas' },
];

export const CLUB_PRUEBA = 'C999';

export const REGIONES = [...new Set(CLUBES.map(c => c.region))];

export function buscarClub(id) {
  return CLUBES.find(c => c.id === id) || null;
}
