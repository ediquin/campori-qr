# Contexto para Claude Code

Este archivo es el traspaso técnico de la última etapa de trabajo del proyecto
`campori-qr`. Está escrito para que otro agente pueda continuar sin reconstruir el
contexto desde la conversación.

## Estado publicado

- Rama: `main`.
- Último commit de la implementación: `59881fa`.
- Commit publicado en `origin/main`.
- Mensaje: `Optimiza hojas de stickers y agrega formato Carta`.
- El proyecto no tiene dependencias de producción ni requiere `npm install`.
- La suite completa pasó con **429 comprobaciones**.
- La suite específica de PDF pasó con **50 comprobaciones**.

Comandos de verificación:

```powershell
node herramientas/pruebas-pdf.mjs
node herramientas/pruebas.mjs
```

Si `node` no está en `PATH` dentro de Codex Desktop, se usó el runtime incluido:

```text
C:\Users\heber\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
```

## Cambios implementados en el generador de stickers

### 1. Empaquetado continuo de eventos

Antes, cada evento empezaba obligatoriamente en una hoja nueva. Esto desperdiciaba
gran parte del papel cuando la cantidad por actividad era menor que la capacidad de
la hoja.

Ahora `planificarPaginas()` en `js/pdf-stickers.js`:

- Mantiene una página abierta hasta llenar su capacidad.
- Coloca el evento siguiente en la primera celda libre, incluso si está en la misma
  fila que el evento anterior.
- Conserva el orden de eventos y stickers.
- No pierde ni duplica stickers.
- Guarda en cada página una colección `bloques`.
- Cada bloque contiene código, nombre, puntos, rango del evento, celda inicial y
  stickers incluidos.
- Numera las páginas globalmente.
- Calcula cuántas páginas ocupa cada evento.

La estructura relevante de una página es conceptualmente:

```js
{
  formatoPapel: 'oficio',
  numeroPagina: 1,
  paginasTotal: 2,
  stickers: [],
  bloques: [
    {
      codigo: 'A03',
      nombre: 'RECEPCIÓN DE SÁBADO',
      inicioCelda: 160,
      desdeEvento: 0,
      hastaEvento: 44,
      totalEvento: 80,
      paginaEvento: 1,
      paginasEvento: 2,
      stickers: [],
    },
  ],
}
```

`resumirPagina()` arma el encabezado. Ejemplo:

```text
A01 - RFA VIERNES [80] | A02 - CULTO GENERAL VIERNES MAÑANA [80] | A03 - RECEPCIÓN DE SÁBADO [1-44 de 80]
```

Cuando el evento continúa, su nombre se repite en la hoja siguiente:

```text
A03 - RECEPCIÓN DE SÁBADO [45-80 de 80]
```

Si una hoja contiene demasiados eventos pequeños para que todos los nombres entren,
el resumen se corta de forma controlada y termina con `+N eventos`. El código del
evento sigue impreso debajo de cada QR.

### 2. Selector de papel Oficio o Carta

El usuario elige el formato en `generador.html`, control `#formato-papel`.

Formatos definidos en `FORMATOS_PAPEL`, dentro de `js/pdf-stickers.js`:

| Formato | Medida exacta | Rejilla | Capacidad |
|---|---:|---:|---:|
| Oficio | 215 x 330 mm | 12 x 17 | 204 QR |
| Carta solicitada | 216 x 281,5 mm | 12 x 14 | 168 QR |

La medida Carta solicitada por el usuario es exactamente **216 x 281,5 mm**. No es
igual al Letter estadounidense habitual de 215,9 x 279,4 mm. No reemplazarla por el
estándar de EE. UU. sin consultarlo.

El formato elegido controla conjuntamente:

- El cálculo de cantidad de hojas.
- La vista previa HTML.
- La regla CSS `@page` usada por `window.print()`.
- La capacidad usada por `planificarPaginas()`.
- El `MediaBox` del PDF vectorial.
- Las coordenadas de cabecera y rejilla.
- El nombre del archivo descargado:
  `stickers-campori-oficio-AAAA-MM-DD.pdf` o
  `stickers-campori-carta-AAAA-MM-DD.pdf`.

Oficio sigue siendo el formato predeterminado.

### 3. Geometría física

Invariantes que no deben cambiarse accidentalmente:

- Cada QR mide exactamente **15 x 15 mm**.
- El sticker completo mide 17,5 mm de alto porque incluye el rótulo.
- Paso horizontal: 16,5 mm.
- Paso vertical: 18 mm.
- Margen de impresión: 5 mm.
- Ambas hojas usan 12 columnas.
- Oficio usa 17 filas.
- Carta usa 14 filas.

La posición horizontal se centra con:

```js
(formato.anchoMm - formato.columnas * PASO_X_MM) / 2
```

La rejilla comienza a:

```js
formato.altoMm - 13.5
```

Las posiciones de título, detalle y separador se derivan del alto del papel. No
volver a introducir coordenadas absolutas exclusivas de Oficio.

En Carta, la última fila conserva margen suficiente:

- Guía inferior: 16,5 mm.
- QR inferior: 19 mm.
- No hay recorte.

Una fila 15 no cabe sin rediseñar la cabecera y los espacios verticales.

### 4. Cambio de formato sin regenerar códigos

Después de generar, el usuario puede cambiar entre Carta y Oficio.

El cambio:

- Reutiliza `ultimaGeneracion`.
- Vuelve a ejecutar únicamente la planificación y la vista previa.
- Conserva los mismos objetos `sticker`.
- Conserva los mismos textos QR.
- Conserva todos los seriales.
- No llama a `nuevoSerial()`.
- No guarda otra tanda en `localStorage`.

Esto se implementa en `mostrarGeneracion()` y en el listener de
`#formato-papel` de `js/generador.js`.

El selector se deshabilita mientras se fabrican QR o se crea el PDF, para impedir
que la vista y el archivo queden con formatos distintos.

### 5. Seriales únicos entre generaciones

Los seriales tienen 8 caracteres Base32 y se crean en `js/identificador.js`.

La unicidad operativa funciona así:

- `serialesUsados` es un `Set`.
- La clave incluye el código del evento: `CODIGO-SERIAL`.
- `crearIdentificador()` vuelve a sortear si encuentra una clave ya usada.
- El conjunto se persiste en `localStorage`.
- Clave de almacenamiento:
  `campori-qr-unicos-${CAMPORI.prefijo}`.

Consecuencia:

- Si se generan 72 QR por actividad y luego 5 más desde el mismo navegador, los
  cinco son nuevos y no repiten los anteriores.
- Volver a descargar el mismo PDF o cambiar el papel conserva deliberadamente los
  mismos códigos, porque es una reimpresión de la misma generación.
- La garantía local se pierde si se borra el almacenamiento del sitio, se usa
  incógnito, otro perfil, otro navegador u otro dispositivo.
- Entre dispositivos independientes una colisión sigue siendo extremadamente
  improbable, pero no existe un inventario central que la impida.

No reemplazar este mecanismo por un contador simple sin diseñar antes cómo se
compartirá entre dispositivos.

## Pruebas realizadas

### Automatizadas

`herramientas/pruebas-pdf.mjs` cubre:

- Oficio 215 x 330 mm.
- Carta 216 x 281,5 mm.
- QR de 15 mm.
- Capacidad Oficio: 204.
- Capacidad Carta: 168.
- 204 y 205 stickers en Oficio.
- 168 y 169 stickers en Carta.
- Dos eventos compartiendo una misma hoja.
- Repetición de nombre y rangos cuando un evento continúa.
- Tres eventos de 80:
  - Oficio: páginas `[204, 36]`; A03 se divide `[44, 36]`.
  - Carta: páginas `[168, 72]`; A03 se divide `[8, 72]`.
- Numeración global de páginas.
- Grupos vacíos.
- Existencia del selector Oficio/Carta.
- Vista previa y PDF usando el mismo planificador.
- Cambio de papel sin generar nuevos QR.
- `MediaBox` exacto para ambos formatos.
- PDF vectorial, sin imágenes incrustadas.
- Tabla `xref` y longitudes de streams válidas.
- Rechazo de PDF vacío.

### Navegador

Se probó el generador mediante el servidor local:

```powershell
node herramientas/servidor.mjs 8765
```

Caso probado:

- Dos actividades.
- 100 QR por actividad.
- Carta mostró 2 hojas.
- Oficio mostró 1 hoja.
- El primer y el último serial fueron idénticos antes y después del cambio.
- No hubo errores de consola.
- La regla dinámica de impresión cambió entre:
  - `@page { size: 216mm 281.5mm; margin: 5mm; }`
  - `@page { size: 215mm 330mm; margin: 5mm; }`

### Revisión visual

Se generaron y renderizaron PDFs de Oficio y Carta con 80 + 80 + 80 stickers.

Resultado Carta:

- Primera hoja: 168 stickers.
- A03 ocupa los últimos 8 lugares.
- Segunda hoja: 72 stickers.
- Cabecera repetida como `A03 ... [9-80 de 80]`.

Resultado Oficio:

- Primera hoja: 204 stickers.
- A03 ocupa los últimos 44 lugares.
- Segunda hoja: 36 stickers.
- Sin recortes, solapamientos ni problemas con acentos.

## Archivos modificados por esta etapa

| Archivo | Responsabilidad |
|---|---|
| `generador.html` | Selector de papel, textos y estilo dinámico de impresión |
| `js/generador.js` | Estado del formato, conteo, rerender, descarga y preservación de seriales |
| `js/pdf-stickers.js` | Formatos, planificación continua, encabezados y geometría PDF |
| `css/impresos.css` | Cabecera compacta y rejilla física común |
| `herramientas/pruebas-pdf.mjs` | Pruebas de ambos tamaños y paginación |
| `sw.js` | Actualización de caché offline |
| `LEEME.md` | Instrucciones de uso e impresión |
| `ARQUITECTURA.md` | Arquitectura y cobertura de pruebas |

Versiones de caché actuales:

- `generador.html` carga `js/generador.js?v=8`.
- `js/generador.js` carga `js/pdf-stickers.js?v=3`.
- Service worker: `campori-qr-v32`.

Si se cambian archivos servidos offline, incrementar nuevamente la versión del
service worker y agregar las nuevas URLs con query string a `ARCHIVOS`.

## Advertencias para impresión

- Recomendar siempre escala **100%**.
- Desactivar `Ajustar a página`.
- Elegir en el controlador de impresora la misma medida que en la aplicación.
- La medida Carta de 216 x 281,5 mm puede aparecer como tamaño personalizado en
  algunos controladores.
- El PDF descargable es más confiable que imprimir directamente desde el navegador.

## Google Sheets: estado analizado, pero no implementado

Durante esta etapa también se revisó el comportamiento de sincronización. No se
modificó todavía.

### Comportamiento actual

`js/evaluador.js` usa sincronización automática con prioridad para cambios locales
pendientes:

- `marcarPendiente()` programa una sincronización después de 900 ms.
- Cada 20 segundos se llama a `sincronizarAutomaticamente()`.
- También se sincroniza al recuperar conexión y volver al primer plano.
- La sincronización normal envía primero los clubes pendientes y luego lee Sheets.
- `Sincronizar ahora` hace el mismo envío seguido de lectura.
- `Traer cambios de la planilla` lee, pero preserva clubes pendientes.
- En la primera migración bidireccional se marcan los datos locales como pendientes,
  se lee la planilla, se sube lo local y se vuelve a leer.
- El Apps Script reemplaza las filas completas de los clubes enviados, no toda la
  planilla.
- Solo `Detalle de escaneos` se importa como fuente de escaneos. Editar directamente
  `Puntajes` no cambia la aplicación.

Por lo tanto, si un club tiene cambios locales pendientes, el teléfono puede volver
a colocar información que se borró manualmente en Sheets.

### Dirección acordada con el usuario

El usuario consideró mejor este flujo:

1. Al conectar, Google Sheets debe ser la fuente principal.
2. Si existen cambios locales pendientes, mostrar tres opciones:
   - `Usar datos de Google Sheets`: descartar pendientes, no subirlos y descargar la
     planilla.
   - `Conservar cambios locales`: mantenerlos sin subirlos.
   - `Cancelar`: no sincronizar.
3. Eliminar las subidas automáticas.
4. Mostrar un botón explícito:
   `Subir cambios pendientes (N)`.
5. Después de subir, volver a leer Sheets.
6. Antes de descartar, confirmar cuántos clubes y escaneos se perderán.

Este rediseño **no está implementado**. No afirmar que Sheets ya tiene prioridad
absoluta.

Archivos relevantes para continuarlo:

- `js/evaluador.js`
- `js/almacen.js`
- `js/sheets.js`
- `herramientas/apps-script.gs`
- `evaluador.html`
- `herramientas/pruebas-sheets.mjs`

URL predeterminada actual del Apps Script:

```text
https://script.google.com/macros/s/AKfycbxb6XecjnQH5mV2gE1vO-9avtspgWLxJTG8Xu-DEW1sr_i4h5swRY9SUASFW-zE2aRs/exec
```

## Reglas para cambios futuros

- No cambiar los códigos de eventos existentes: los QR impresos dependen de ellos.
- Agregar eventos nuevos al final del catálogo.
- Mantener vista previa y PDF sobre el mismo `planificarPaginas()`.
- No duplicar otra lógica de paginación en `js/generador.js`.
- No cambiar tamaños físicos sin agregar pruebas de `MediaBox` y revisión visual.
- No regenerar seriales al cambiar formato.
- No confiar solo en extracción de texto para revisar PDFs; renderizarlos.
- Ejecutar la suite completa antes de publicar.
- Después de publicar, comprobar que `main` y `origin/main` apunten al mismo commit.
