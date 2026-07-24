// Corre todas las pruebas del proyecto.
//
//   node herramientas/pruebas.mjs
//
// Sin framework de testing a proposito: el proyecto no tiene dependencias y tiene que
// poder verificarse en cualquier maquina con node, sin instalar nada.

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ['Nucleo: firma de los QR y motor de puntaje', 'pruebas-nucleo.mjs'],
  ['Generador de codigos QR', 'pruebas-qr.mjs'],
  ['Lector de codigos QR (el que usan los iPhone)', 'pruebas-decoder.mjs'],
  ['Exportacion a Excel', 'pruebas-exportar.mjs'],
  ['Escenario completo sobre el club de prueba', 'pruebas-escenario.mjs'],
];

let fallidas = 0;
for (const [titulo, archivo] of SUITES) {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`);
  const r = spawnSync(process.execPath, [path.join(AQUI, archivo)], { stdio: 'inherit' });
  if (r.status !== 0) fallidas++;
}

console.log(`\n${'='.repeat(78)}`);
if (fallidas) {
  console.error(`${fallidas} de ${SUITES.length} suites FALLARON.`);
  process.exit(1);
}
console.log(`Las ${SUITES.length} suites pasaron.`);
