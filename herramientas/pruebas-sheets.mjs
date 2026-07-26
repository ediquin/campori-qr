// Verifica la fusion de envios en Google Sheets.
//
//   node herramientas/pruebas-sheets.mjs
//
// El riesgo concreto: si dos evaluadores mandan a la misma planilla y el script
// reemplaza todo, el segundo envio borra el trabajo del primero. Aca se reproduce
// esa situacion con la misma logica que corre dentro de Apps Script y se comprueba
// que cada uno actualiza solo lo suyo.
//
// Nota: se reimplementa la fusion en vez de importar apps-script.gs porque ese
// archivo corre dentro de Google y usa sus APIs. Lo que se prueba es la REGLA;
// si cambia una, hay que cambiar la otra.

import {
  URL_PREDETERMINADA, migrarUrlPredeterminada,
  normalizarSeriales, normalizarEscaneos, normalizarEventos, normalizarPuntajes,
  conflictosRemotosParaClub, capturarRevisionesPendientes,
  confirmarPendientesAplicados, debeReprogramarSincronizacion,
  totalDesdeEventos, diferenciasDePuntajes, clubesProtegidosParaLectura,
  normalizarRevisionesDetalle, combinarRevisionesDetalle,
  serializarRevisionesDetalle, restaurarRevisionesDetalle,
  aplicarRevisionesConfirmadas,
  aplicarConflictosDeSerial, puntajesDesdeDetalle,
  detalleVacioEsDestructivo, detalleRemotoVacioEsSospechoso,
} from '../js/sheets.js';

let pasadas = 0;
const fallos = [];
function comprobar(nombre, obtenido, esperado) {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) { pasadas++; return; }
  fallos.push(`${nombre}\n      obtenido: ${JSON.stringify(obtenido)}\n      esperado: ${JSON.stringify(esperado)}`);
}
const grupo = t => console.log(`\n--- ${t}`);

/** Misma regla que doPost() en herramientas/apps-script.gs. */
function fusionar(hojaPrevia, entrada) {
  const encabezado = entrada.filas[0];
  const nuevas = entrada.filas.slice(1);

  if (entrada.reemplazar || entrada.claveColumna == null) {
    return [encabezado, ...nuevas];
  }

  const col = entrada.claveColumna;
  const entrantes = new Set((entrada.clubesReemplazar || []).map(String));
  nuevas.forEach(f => entrantes.add(String(f[col])));
  const previas = hojaPrevia.length > 1 ? hojaPrevia.slice(1) : [];
  const conservadas = previas.filter(f => String(f[col]) !== '' && !entrantes.has(String(f[col])));

  const finales = [...conservadas, ...nuevas];
  finales.sort((a, b) => String(a[col]).localeCompare(String(b[col])));
  return [encabezado, ...finales];
}

const ENCABEZADO = ['ID', 'Club', 'Total'];
const idsDe = hoja => hoja.slice(1).map(f => f[0]);
const totalDe = (hoja, id) => (hoja.slice(1).find(f => f[0] === id) || [])[2];

grupo('Dos evaluadores mandan a la misma planilla');

{
  // Heber evaluo tres clubes de la Region 1.
  const deHeber = {
    nombre: 'Puntajes', claveColumna: 0,
    filas: [ENCABEZADO, ['C001', 'Aziel Calacoto Jr.', 3000], ['C002', 'Gerizim', 2800], ['C003', 'Lemuel', 3000]],
  };
  // Maria evaluo dos de la Region 8, distintos.
  const deMaria = {
    nombre: 'Puntajes', claveColumna: 0,
    filas: [ENCABEZADO, ['C053', 'Guardianes', 2600], ['C054', 'Haverin', 3000]],
  };

  let planilla = [ENCABEZADO];
  planilla = fusionar(planilla, deHeber);
  comprobar('tras el envio de Heber', idsDe(planilla), ['C001', 'C002', 'C003']);

  planilla = fusionar(planilla, deMaria);
  comprobar('tras el envio de Maria estan los cinco', idsDe(planilla),
    ['C001', 'C002', 'C003', 'C053', 'C054']);
  comprobar('lo de Heber sigue intacto', totalDe(planilla, 'C001'), 3000);
  comprobar('lo de Maria entro', totalDe(planilla, 'C054'), 3000);
}

grupo('Reenviar no duplica ni pisa');

{
  let planilla = [ENCABEZADO,
    ['C001', 'Aziel Calacoto Jr.', 3000], ['C053', 'Guardianes', 2600]];

  // Heber corrige un club y reenvia lo suyo.
  planilla = fusionar(planilla, {
    nombre: 'Puntajes', claveColumna: 0,
    filas: [ENCABEZADO, ['C001', 'Aziel Calacoto Jr.', 2800]],
  });

  comprobar('no se duplican filas', idsDe(planilla), ['C001', 'C053']);
  comprobar('el club corregido quedo con el valor nuevo', totalDe(planilla, 'C001'), 2800);
  comprobar('el club del otro evaluador no se toco', totalDe(planilla, 'C053'), 2600);
}

grupo('El orden de llegada no cambia el resultado');

{
  const a = { nombre: 'P', claveColumna: 0, filas: [ENCABEZADO, ['C010', 'Diez', 1000]] };
  const b = { nombre: 'P', claveColumna: 0, filas: [ENCABEZADO, ['C002', 'Dos', 2000]] };
  const c = { nombre: 'P', claveColumna: 0, filas: [ENCABEZADO, ['C100', 'Cien', 3000]] };

  const unOrden = [a, b, c].reduce((p, e) => fusionar(p, e), [ENCABEZADO]);
  const otroOrden = [c, a, b].reduce((p, e) => fusionar(p, e), [ENCABEZADO]);
  comprobar('mande quien mande primero, la planilla queda igual', unOrden, otroOrden);
  comprobar('y queda ordenada por ID', idsDe(unOrden), ['C002', 'C010', 'C100']);
}

grupo('Casos que no deben romper');

{
  // Hoja de parametros: sin clave de club, se reescribe entera.
  const previa = [['Parámetro', 'Valor'], ['Campori', 'viejo']];
  const nueva = fusionar(previa, { nombre: 'Parámetros', reemplazar: true, filas: [['Parámetro', 'Valor'], ['Campori', 'nuevo']] });
  comprobar('los parametros se reescriben', nueva, [['Parámetro', 'Valor'], ['Campori', 'nuevo']]);

  // Un envio sin filas de datos no borra nada.
  const conDatos = [ENCABEZADO, ['C001', 'Uno', 100]];
  comprobar('un envio vacio deja la planilla como estaba',
    fusionar(conDatos, { nombre: 'Puntajes', claveColumna: 0, filas: [ENCABEZADO] }), conDatos);

  // Filas viejas con el ID en blanco se descartan, no se arrastran.
  const conBasura = [ENCABEZADO, ['', 'fila suelta', 0], ['C001', 'Uno', 100]];
  const limpia = fusionar(conBasura, { nombre: 'Puntajes', claveColumna: 0, filas: [ENCABEZADO, ['C002', 'Dos', 200]] });
  comprobar('las filas sin ID no se arrastran', idsDe(limpia), ['C001', 'C002']);
}

grupo('Lo que el envio NO hace');

{
  // Un telefono que manda TODOS los clubes, incluidos los que no evaluo, pisaria
  // el trabajo del otro con ceros. Por eso la app manda solo lo suyo: esta prueba
  // deja documentado por que.
  let planilla = [ENCABEZADO, ['C053', 'Guardianes', 2600]];
  const malEnvio = {
    nombre: 'Puntajes', claveColumna: 0,
    filas: [ENCABEZADO, ['C001', 'Aziel', 3000], ['C053', 'Guardianes', 0]],
  };
  const rota = fusionar(planilla, malEnvio);
  comprobar('mandar clubes no evaluados SI los pisaria (por eso no se hace)',
    totalDe(rota, 'C053'), 0);

  const buenEnvio = {
    nombre: 'Puntajes', claveColumna: 0,
    filas: [ENCABEZADO, ['C001', 'Aziel', 3000]],
  };
  const sana = fusionar(planilla, buenEnvio);
  comprobar('mandando solo lo propio, el otro club queda intacto', totalDe(sana, 'C053'), 2600);
}

grupo('Un mismo sticker en dos clubes deja a ambos en conflicto');

{
  const qr = 'AV5-F03-200-0147-K7M2';
  const remotos = normalizarSeriales({
    [qr]: ['C012', 'C053', 'C012'],
  });

  comprobar('normaliza y elimina clubes repetidos',
    remotos.get(qr), ['C012', 'C053']);
  comprobar('C012 ve que el sticker tambien aparece en C053',
    conflictosRemotosParaClub(remotos, 'C012').get(qr), 'C053');
  comprobar('C053 ve que el sticker tambien aparece en C012',
    conflictosRemotosParaClub(remotos, 'C053').get(qr), 'C012');
  comprobar('un tercer club tambien ve el conflicto',
    conflictosRemotosParaClub(remotos, 'C070').get(qr), 'C012');

  const antiguo = normalizarSeriales({ [qr]: 'C012' });
  comprobar('acepta respuestas antiguas con un solo club',
    antiguo.get(qr), ['C012']);
}

grupo('Sincronizacion bidireccional');

{
  const previa = [
    ['ID', 'Código QR'],
    ['C001', 'F01-AAAAAAAA'],
    ['C002', 'F02-BBBBBBBB'],
  ];
  const corregida = fusionar(previa, {
    nombre: 'Detalle de escaneos',
    claveColumna: 0,
    clubesReemplazar: ['C001'],
    filas: [['ID', 'Código QR']],
  });
  comprobar('borrar la ultima fila de un club tambien se sincroniza',
    corregida, [['ID', 'Código QR'], ['C002', 'F02-BBBBBBBB']]);
}

grupo('Matriz de puntajes por evento');

{
  const eventos = normalizarEventos([
    { codigo: ' f01 ', nombre: 'Aventu acampante', columna: 4 },
    { codigo: 'E01', nombre: 'Biblia', columna: 18 },
    { codigo: 'F01', nombre: 'Duplicado', columna: 99 },
    { codigo: 'TOTAL', nombre: 'No es evento' },
  ]);
  comprobar('reconoce los eventos por código y deduplica',
    eventos.map(e => e.codigo), ['F01', 'E01']);

  const puntajes = normalizarPuntajes([
    {
      idClub: 'C001',
      eventos: { F01: 200, E01: '', A99: 500 },
      total: 200,
      totalConFormula: true,
      revision: 3,
    },
    { idClub: '', eventos: { F01: 999 } },
  ], eventos);
  comprobar('cero es el valor por defecto de una celda de evento',
    puntajes.get('C001').eventos, { F01: 200, E01: 0 });
  comprobar('conserva revisión y total de la fila',
    [puntajes.get('C001').total, puntajes.get('C001').totalConFormula,
      puntajes.get('C001').revision],
    [200, true, 3]);

  comprobar('normaliza las huellas de Detalle por club',
    [...normalizarRevisionesDetalle({ ' C001 ': ' 8-abcd ', '': 'x', C002: '' })],
    [['C001', '8-abcd']]);
}

/**
 * Regla equivalente a aplicarCambiosPuntajes() de Apps Script, reducida a un
 * objeto en memoria para comprobar la concurrencia por celda.
 */
function aplicarParches(matriz, cambios) {
  const resultado = structuredClone(matriz);
  const aplicados = [];
  const conflictos = [];
  for (const cambio of cambios) {
    const fila = resultado[cambio.idClub];
    if (!fila) { conflictos.push({ idClub: cambio.idClub }); continue; }
    const malos = Object.keys(cambio.eventos).filter(codigo =>
      Number(fila[codigo] || 0) !== Number(cambio.anteriores[codigo] || 0)
    );
    if (malos.length) {
      conflictos.push(...malos.map(codigo => ({ idClub: cambio.idClub, codigo })));
      continue;
    }
    Object.assign(fila, cambio.eventos);
    aplicados.push(cambio.idClub);
  }
  return { matriz: resultado, aplicados, conflictos };
}

{
  const inicial = {
    C001: { F01: 0, F02: 0 },
    C002: { F01: 0, F02: 0 },
  };
  const a = { idClub: 'C001', eventos: { F01: 200 }, anteriores: { F01: 0 } };
  const b = { idClub: 'C002', eventos: { F02: 200 }, anteriores: { F02: 0 } };
  const distintos = aplicarParches(inicial, [a, b]);
  comprobar('dos teléfonos actualizan clubes distintos sin pisarse',
    distintos.matriz, { C001: { F01: 200, F02: 0 }, C002: { F01: 0, F02: 200 } });

  const c = { idClub: 'C001', eventos: { F02: 200 }, anteriores: { F02: 0 } };
  const mismoClub = aplicarParches(aplicarParches(inicial, [a]).matriz, [c]);
  comprobar('dos teléfonos actualizan eventos distintos del mismo club',
    mismoClub.matriz.C001, { F01: 200, F02: 200 });

  const choque = { idClub: 'C001', eventos: { F01: 100 }, anteriores: { F01: 0 } };
  const enConflicto = aplicarParches(aplicarParches(inicial, [a]).matriz, [choque]);
  comprobar('la misma celda desactualizada se rechaza',
    [enConflicto.matriz.C001.F01, enConflicto.conflictos.length], [200, 1]);
}

{
  const anteriorV2 = 'https://script.google.com/macros/s/AKfycbyOMhY3Fr-UEjJJVQ66UStBJa4ieeOhBnKfJYFD2hsuud9TvF7w1zu4PYs0o1LWyIuM/exec';
  const anteriorReciente = 'https://script.google.com/macros/s/AKfycby2PyREewpwwiTkPXoceYlAUsH2pzDYbMMtZ3c6EVP0Oc_eE-7-otfUdoeSlgGLVCb0/exec';
  const anteriorInicial = 'https://script.google.com/macros/s/AKfycbzEND2XJJ0dKOW6EnG8OIfhTs7cwYNHjGKIp5ub9a1VxnLnNY6sgHn42TjncgXs38JN/exec';
  const anteriorApi3 = 'https://script.google.com/macros/s/AKfycbzNc5k6vQBXXjlnaWsu7Mjdu9QlW7z3oDsXLZUUA3cccYXjbAL_ZIZs17MDm5KBkWEA/exec';
  const personalizada = 'https://script.google.com/macros/s/personalizada/exec';
  comprobar('los telefonos nuevos reciben la URL vigente',
    migrarUrlPredeterminada(''), URL_PREDETERMINADA);
  comprobar('la primera implementación v2 se migra',
    migrarUrlPredeterminada(anteriorV2), URL_PREDETERMINADA);
  comprobar('la implementacion oficial reciente se migra',
    migrarUrlPredeterminada(anteriorReciente), URL_PREDETERMINADA);
  comprobar('la primera implementacion oficial tambien se migra',
    migrarUrlPredeterminada(anteriorInicial), URL_PREDETERMINADA);
  comprobar('la implementacion API 3 anterior se migra al endpoint vigente',
    migrarUrlPredeterminada(anteriorApi3), URL_PREDETERMINADA);
  comprobar('una URL personalizada se conserva',
    migrarUrlPredeterminada(personalizada), personalizada);
}

{
  const escaneos = normalizarEscaneos([
    { idClub: ' C001 ', crudo: 'f01-aaaaaaaa', ts: 20, dispositivo: ' Ana ' },
    { idClub: 'C001', crudo: 'F01-AAAAAAAA', ts: 20, dispositivo: 'Ana' },
    { idClub: 'C002', crudo: 'F02-BBBBBBBB', ts: 10 },
    { idClub: '', crudo: 'F03-CCCCCCCC', ts: 30 },
  ]);
  comprobar('normaliza y deduplica el estado remoto', escaneos.length, 2);
  comprobar('ordena los escaneos remotos por fecha',
    escaneos.map(e => e.idClub), ['C002', 'C001']);
  comprobar('normaliza el texto QR recibido',
    escaneos[1].crudo, 'F01-AAAAAAAA');
}

grupo('Un QR escaneado durante un envío no se pierde');

{
  const pendientes = new Set(['C024', 'C030']);
  const eventosPendientes = new Map([
    ['C024', new Set(['F01'])],
    ['C030', new Set(['F04'])],
  ]);
  const revisiones = new Map([['C024', 1], ['C030', 1]]);
  const enviadas = capturarRevisionesPendientes(revisiones, pendientes);

  // El POST sigue viajando cuando Central escanea F02.
  revisiones.set('C024', 2);
  eventosPendientes.get('C024').add('F02');

  const primera = confirmarPendientesAplicados(
    ['C024', 'C030'], enviadas, revisiones, pendientes, eventosPendientes
  );
  comprobar('el club que cambió durante el POST queda pendiente',
    primera, { confirmados: ['C030'], conservados: ['C024'] });
  comprobar('conserva tanto la celda enviada como la celda recién escaneada',
    [...eventosPendientes.get('C024')], ['F01', 'F02']);
  comprobar('el otro club sí sale de la cola',
    [...pendientes], ['C024']);

  const segundoEnvio = capturarRevisionesPendientes(revisiones, pendientes);
  confirmarPendientesAplicados(
    ['C024'], segundoEnvio, revisiones, pendientes, eventosPendientes
  );
  comprobar('el reenvío estable confirma y limpia Central',
    [pendientes.size, eventosPendientes.size, revisiones.size], [0, 0, 0]);
}

{
  const pendientes = new Set(['C024']);
  const eventosPendientes = new Map([['C024', new Set()]]);
  const revisiones = new Map([['C024', 4]]);
  const enviadas = capturarRevisionesPendientes(revisiones, pendientes);

  // Quitar un escaneo puede modificar solamente el detalle, aunque la celda
  // agregada conserve el mismo valor; también debe sobrevivir a la carrera.
  revisiones.set('C024', 5);
  const resultado = confirmarPendientesAplicados(
    ['C024'], enviadas, revisiones, pendientes, eventosPendientes
  );
  comprobar('un cambio solo de detalle también permanece en cola',
    [resultado.conservados, pendientes.size], [['C024'], 1]);

  comprobar('se reprograma si apareció un cambio nuevo',
    debeReprogramarSincronizacion(4, 5, pendientes.size), true);
  comprobar('no crea un ciclo si no hubo cambios nuevos',
    debeReprogramarSincronizacion(5, 5, pendientes.size), false);
  comprobar('no reprograma una cola ya vacía',
    debeReprogramarSincronizacion(4, 5, 0), false);
}

grupo('Invariantes entre Detalle, matriz y TOTAL');

{
  const local = {
    F01: 200, F02: 200, F03: 200, F04: 200,
    F05: 200, F06: 200, F07: 200, F08: 200,
  };
  const remoto = {
    F01: 200, F02: 0, F03: 0, F04: 200,
    F05: 0, F06: 200, F07: 200, F08: 200,
  };
  const diferencias = diferenciasDePuntajes(local, remoto, Object.keys(local));
  comprobar('reproduce las tres celdas perdidas del caso Central',
    diferencias.map(d => [d.codigo, d.remoto, d.local]),
    [['F02', 0, 200], ['F03', 0, 200], ['F05', 0, 200]]);
  comprobar('el detalle de ocho físicos exige 1600',
    totalDesdeEventos(local), 1600);
  comprobar('la matriz incompleta explica el total incorrecto de 1000',
    totalDesdeEventos(remoto), 1000);
  comprobar('Detalle vacío bloquea una puesta a cero masiva',
    detalleVacioEsDestructivo(0, [{ codigo: 'F01', local: 0, remoto: 200 }]), true);
  comprobar('Detalle con evidencia permite revisar la misma diferencia',
    detalleVacioEsDestructivo(8, [{ codigo: 'F01', local: 0, remoto: 200 }]), false);
  comprobar('un GET vacío no borra una copia local aunque la matriz también esté en cero',
    detalleRemotoVacioEsSospechoso(
      8,
      []
    ), true);
  comprobar('un GET vacío sí es válido si todos los datos locales están protegidos',
    detalleRemotoVacioEsSospechoso(
      0,
      []
    ), false);

  const primeraMatriz = aplicarParches(
    { C024: Object.fromEntries(Object.keys(local).map(codigo => [codigo, 0])) },
    [{
      idClub: 'C024',
      eventos: { F01: 200, F04: 200, F06: 200, F07: 200, F08: 200 },
      anteriores: { F01: 0, F04: 0, F06: 0, F07: 0, F08: 0 },
    }]
  ).matriz;
  const segundoEnvio = {
    idClub: 'C024',
    eventos: { ...local },
    anteriores: { ...primeraMatriz.C024 },
  };
  const reparada = aplicarParches(primeraMatriz, [segundoEnvio]);
  comprobar('el reenvío posterior termina con las ocho celdas y 1600',
    [
      reparada.conflictos.length,
      Object.values(reparada.matriz.C024).filter(v => v === 200).length,
      totalDesdeEventos(reparada.matriz.C024),
    ],
    [0, 8, 1600]);
}

{
  const fisicos = Object.fromEntries(
    Array.from({ length: 14 }, (_, i) => [`F${String(i + 1).padStart(2, '0')}`, 200])
  );
  comprobar('las catorce columnas físicas producen 2800',
    totalDesdeEventos(fisicos), 2800);
  comprobar('tres Puntos extra se comparan como 150, no como 50',
    diferenciasDePuntajes({ A36: 150 }, { A36: 50 }, ['A36']),
    [{ codigo: 'A36', local: 150, remoto: 50 }]);
  comprobar('el TOTAL conserva el piso en cero ante sanciones',
    totalDesdeEventos({ F01: 200, S01: -2000 }), 0);
}

{
  const protegidos = clubesProtegidosParaLectura(
    new Set(['C001']),
    new Map([['C024', 1], ['C030', 2]])
  );
  comprobar('un GET preserva pendientes y escrituras locales todavía en curso',
    [...protegidos], ['C001', 'C024', 'C030']);

  const revisiones = combinarRevisionesDetalle(
    new Map([['C001', '0-base'], ['C024', '1-base']]),
    new Map([['C001', '1-remota'], ['C024', '2-remota'], ['C030', '1-remota']]),
    protegidos,
    new Set(['C001', 'C024', 'C030'])
  );
  comprobar('un GET no adelanta ni inventa la huella de un club pendiente',
    [...revisiones],
    [['C001', '0-base'], ['C024', '1-base']]);
  comprobar('una caché sin base solo adopta revisión si el club remoto está vacío',
    [
      ...combinarRevisionesDetalle(
        new Map(),
        new Map([['C030', '0-vacia']]),
        new Set(['C030']),
        new Set()
      ),
    ],
    [['C030', '0-vacia']]);

  const url = 'https://script.google.com/macros/s/seguro/exec';
  const guardadas = serializarRevisionesDetalle(
    url,
    new Map([['C001', '0-base']])
  );
  const restauradas = restaurarRevisionesDetalle(guardadas, url);
  const despuesDeRecargar = combinarRevisionesDetalle(
    restauradas,
    new Map([['C001', '1-ajena']]),
    new Set(['C001']),
    new Set(['C001'])
  );
  comprobar('una recarga conserva la huella base del club pendiente',
    [...despuesDeRecargar], [['C001', '0-base']]);
  comprobar('las huellas de otra planilla nunca se reutilizan',
    [...restaurarRevisionesDetalle(guardadas, `${url}-otra`)], []);

  const despuesDelPostPropio = aplicarRevisionesConfirmadas(
    despuesDeRecargar,
    new Map([['C001', '1-propia']]),
    ['C001']
  );
  const getConCambioPosterior = combinarRevisionesDetalle(
    despuesDelPostPropio,
    new Map([['C001', '2-ajena']]),
    new Set(['C001']),
    new Set(['C001'])
  );
  comprobar('un POST confirmado avanza la base aun si entró otro QR local',
    [...getConCambioPosterior], [['C001', '1-propia']]);
}

{
  const visibles = aplicarConflictosDeSerial(
    { F01: 200, A36: 200 },
    { F01: 0, A36: 150 },
    [
      { estado: 'serial_ajeno', evento: { codigo: 'F01' } },
      { estado: 'contado', evento: { codigo: 'A36' } },
      { estado: 'serial_ajeno', evento: { codigo: 'A36' } },
    ]
  );
  comprobar('un serial ajeno deja de sumar en la vista aunque la matriz esté pendiente',
    visibles, { F01: 0, A36: 150 });
}

{
  const codigos = [
    ...Array.from({ length: 14 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 7 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`),
    'A36', 'S02',
  ];
  const detalle = [
    ...codigos.filter(c => c.startsWith('F')).map(codigo =>
      ({ estado: 'contado', evento: { codigo }, puntos: 200 })),
    ...codigos.filter(c => c.startsWith('E')).map(codigo =>
      ({ estado: 'contado', evento: { codigo }, puntos: 200 })),
    ...Array.from({ length: 3 }, () =>
      ({ estado: 'contado', evento: { codigo: 'A36' }, puntos: 50 })),
    { estado: 'serial_repetido', evento: { codigo: 'A36' }, puntos: 0 },
    { estado: 'serial_ajeno', evento: { codigo: 'A36' }, puntos: 0 },
    { estado: 'contado', evento: { codigo: 'S02' }, puntos: -500 },
  ];
  const matriz = puntajesDesdeDetalle(detalle, codigos);
  comprobar('el detalle transversal agrega tres A36 reales en una sola celda',
    matriz.A36, 150);
  comprobar('la matriz transversal produce TOTAL 3850',
    totalDesdeEventos(matriz), 3850);
}

console.log('');
if (fallos.length) {
  for (const f of fallos) console.error(`FALLA ${f}`);
  console.error(`\n${pasadas} pasadas, ${fallos.length} FALLIDAS`);
  process.exit(1);
}
console.log(`${pasadas} pruebas pasadas.`);
