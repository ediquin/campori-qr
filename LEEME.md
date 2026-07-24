# Sistema de puntajes por QR — Campori de Aventureros

Evaluación de las fichas de los clubes escaneando códigos QR con el celular, con
puntaje automático y exportación a Excel.

Sin dependencias: no hay `npm install`, no hay compilación, no hay servidor de
aplicaciones. Son archivos HTML, CSS y JavaScript que el navegador abre tal cual.

---

## Las reglas que aplica

| Bloque | Eventos | Puntos c/u | Regla | Máximo |
|---|---|---|---|---|
| Físicos | 14 disponibles | 200 | Solo cuentan los **8 primeros escaneados** | **1600** |
| Espirituales | 7 | 200 | Los 7 son **obligatorios** | **1400** |
| **Puntaje base** | | | | **3000** |
| Adicional | 36 eventos | 50 a 500 | Cada evento cuenta una vez y suma **aparte** del puntaje base | — |
| Sanciones | 3 | −2000 / −500 | Restan del total; se pueden repetir (varios días) | — |

Los físicos y espirituales suman 200; los adicionales suman lo que dice el catálogo
(los 29 originales 100; Plaza / Seguridad / Limpieza Km4 200).

**Botiquín es una rúbrica de tres niveles**: Personal (500), Proactividad (450) y
Solo Botiquín (250). El club recibe **uno solo**, el que le corresponda. Si por error
un club termina con dos pegados, la app cuenta solo el más alto y marca el cruce como
**alerta grave** para que lo revisen y aclaren.

Las **sanciones** restan puntaje. Una misma sanción puede aplicarse varias veces (con
stickers distintos), pero el mismo sticker no resta dos veces. El **total nunca baja
de 0**: una sanción se come los puntos que el club tenga y no más. En el evaluador se
ven en rojo, y en el Excel hay columnas de "Sanciones" y "Puntos sanción".

Lo que el sistema detecta solo:

- **Evento repetido** — dos stickers distintos del mismo evento.
- **Más de 8 físicos** — cuentan los 8 primeros que escaneás, el resto queda marcado.
- **Sticker escaneado dos veces** — la misma fotocopia pegada dos veces.
- **Sticker de otro club** — uno despegado de otra ficha. Dice de qué club era.
- **QR falsificado** — cualquiera que no lleve nuestra firma.
- **Espirituales faltantes** — lista cuáles.

---

## Qué hay que hacer, en orden

### 1. Antes del campori — configurar

Abrí `js/catalogo.js`. Ahí están los eventos, sus puntajes y las sanciones: es el
único archivo que hay que tocar si algo de eso cambia. Agregá eventos nuevos **al
final** (con códigos nuevos), nunca renumeres los existentes: los QR ya impresos
dependen de su código.

- `CRITERIOS_ADICIONALES`: los 33 eventos adicionales. Los primeros 29 valen 100; los
  últimos cuatro valen 500 (Botiquín) y 200 (Plaza / Seguridad / Limpieza Km4).
- `SANCIONES`: las tres que restan (`S01`–`S03`).
- `clave`: hoy solo firma el QR de cabecera del club, no los stickers de evento. No
  hace falta cambiarla salvo que quieras.

### 2. Imprimir

Abrí `generador.html`:

Elegí los eventos y cuántos QR necesitás por evento (80 alcanza: son 74 clubes). Las
**sanciones vienen destildadas** a propósito: marcá solo las que vayas a usar, y pocas.

Cada evento se imprime como un **bloque con su título encima de sus QR** (por ejemplo
"A30 · BOTIQUÍN · 500 pts · 15 QR"), así al recortar cada lote queda rotulado. Varios
eventos chicos comparten hoja, cada uno con su título; un evento largo continúa en la
hoja siguiente repitiendo el título con el rango.
Después elegí el tamaño de papel: **Oficio (21,5 × 33 cm)** admite 204 QR y
**Carta (21,6 × 28,15 cm)** admite 168 QR. En ambos casos cada QR conserva 15 mm.
Los eventos se acomodan de forma continua para aprovechar el espacio restante; la
cabecera muestra los nombres y rangos presentes y repite el evento cuando continúa.
Quedan listos para recortar y darle al juez de esa estación. La página no genera
fichas ni pide inventarios.
Cada nueva generación crea identificadores aleatorios distintos.

Después de generar, tocá **Descargar PDF**. El archivo sale con el tamaño elegido
y cada QR vectorial de 15 mm. También podés usar **Imprimir**; en ese caso elegí
en la impresora la misma medida y hacelo **al 100%, sin "ajustar a página"**, o
los 15 mm dejan de ser 15 mm.

### 3. Durante el campamento

Cada juez tiene el taco de stickers de su evento y le da uno al club que lo
completa. El club los pega en su ficha.

### 4. Evaluar

Abrí `evaluador.html` en el celular:

1. Elegí el club, o **escaneá el QR de la cabecera de la ficha** (más rápido).
2. Encendé la cámara y pasá cada sticker. Suena y vibra en cada escaneo:
   un tono ascendente si sumó, otro distinto si hay problema.
3. Tocá **Marcar ficha como terminada**.
4. En **Resultados**, **Descargar Excel**.

### Evaluando entre varios

Google Sheets es la vía compartida y la fuente central. Al abrir el evaluador aparece
la pantalla **Conectar con Google Sheets**. Después de conectarse:

1. Cada escaneo o eliminación se envía automáticamente.
2. La aplicación revisa la planilla al recargar, cada 20 segundos y al volver a primer plano.
3. Sin señal, los cambios quedan pendientes en el teléfono y se envían al reconectar.

Si al conectarse ya existen cambios pendientes en el teléfono, la aplicación se
detiene antes de enviar y ofrece tres opciones: **subirlos**, **descartarlos y usar
Google Sheets**, o **seguir sin conexión**. Descartar elimina solamente la copia
local de escaneos y estados; conserva la dirección, la clave y el nombre del
evaluador, y reconstruye los resultados con lo que exista en la planilla.

El detalle siempre se envía: es indispensable para detectar el mismo serial en dos
clubes. Si eso ocurre, **ninguno recibe los puntos** hasta que se aclare el incidente
con los directores y se corrija manualmente la planilla final.

Tres cosas que conviene respetar:

1. **Repartan los clubes de antemano**, lo más simple es por región. Cada evaluador
   toca solo sus clubes.
2. **Pónganle nombre a cada teléfono** en `Ajustes → Este teléfono`. Queda anotado en
   cada escaneo, y así la app puede avisar si dos personas evaluaron el mismo club.
3. **Revisen que la hora de los celulares esté bien.** La regla de "los 8 primeros
   eventos físicos" usa la hora del escaneo.

### Sincronización con Google Sheets

La app necesita internet solamente al enviar o traer información. Sin señal sigue
escaneando, puntuando y guardando en el teléfono; la sincronización se hace después.

Preparación, una sola vez:

1. Creá una planilla nueva en Google Sheets.
2. `Extensiones → Apps Script`. Borrá lo que haya y pegá
   [`herramientas/apps-script.gs`](herramientas/apps-script.gs).
3. Cambiá la línea de `CLAVE` por una frase tuya.
4. `Implementar → Nueva implementación → Aplicación web`, con **Ejecutar como: Yo** y
   **Quién tiene acceso: Cualquier usuario**.
5. Copiá la dirección que termina en `/exec` y pegala en la pantalla inicial de la
   aplicación, junto con la misma clave.

Cada teléfono manda **solo las celdas de eventos que modificó**, agrupadas por club,
junto con el detalle de sus escaneos. El Apps Script aplica esos parches bajo bloqueo
y compara el valor anterior de cada celda. Dos evaluadores que trabajan clubes
distintos no se pisan; si intentan cambiar la misma celda desde un estado viejo, se
devuelve un conflicto y la app obliga a refrescar. La hoja `Envíos` deja constancia
de quién mandó qué y cuándo.

La dirección y la clave se guardan **en el teléfono**, nunca en el repositorio. Quien
tenga esa dirección puede escribir en tu planilla, así que no la publiques.

#### Correcciones manuales en Google Sheets

La hoja **Puntajes** es la fuente del número mostrado por la app. Tiene `ID`, `Club`,
`Región`, una columna por cada código de evento y `TOTAL`. Corregí la celda del evento
correspondiente y usá **0** cuando no fue realizado. El cambio aparece al recargar,
al volver a la app o en un máximo aproximado de 20 segundos.

No cambies `ID` ni edites `TOTAL`: TOTAL es una fórmula. Si además hay que invalidar
un sticker, borrá o corregí su fila en **Detalle de escaneos**, que sigue siendo la
auditoría para detectar un mismo QR en dos clubes.

Cuando un QR aparece en dos clubes, ambos quedan con ese sticker en conflicto y
reciben 0 puntos. La decisión sobre el dueño legítimo se toma fuera de la app.

El botón **Sincronizar ahora** permite forzar la actualización sin esperar 20 segundos.

---

## Lo que necesita para funcionar

**La cámara solo funciona con HTTPS.** No alcanza con abrir el archivo haciendo
doble clic. Hay dos caminos:

- **Publicarlo** (recomendado). GitHub Pages, Netlify Drop o Cloudflare Pages son
  gratis y dan HTTPS. Subís la carpeta y listo. Una vez que cada celular abrió la
  app, sigue andando **sin señal**: es una PWA con todo guardado localmente.
- **En red local**, con `node herramientas/servidor.mjs`. Sirve para probar en la
  computadora (`localhost` cuenta como seguro), pero desde el celular por IP el
  navegador va a bloquear la cámara igual.

**Navegador: anda en todos**, incluido Safari de iPhone. Hay dos motores de lectura
y la app elige solo:

- Chrome y Edge (Android y computadora) usan `BarcodeDetector`, la API que trae el
  navegador, acelerada por hardware.
- Safari no la tiene, así que ahí entra el lector propio del proyecto
  (`js/qr-decoder.js`), escrito para este caso. Tarda entre 7 y 35 ms por cuadro,
  imperceptible al escanear.

Los dos funcionan sin internet. Podés comprobar cuál usa cada celular, y probar la
cámara, en **`prueba-camara.html`**: muestra el motor, deja escanear en vivo y trae
códigos de muestra del tamaño real.

Una diferencia práctica: el lector propio necesita el celular **más derecho** sobre
la ficha. Aguanta el código girado en cualquier ángulo, pero mirándolo muy de costado
(más de unos 45° respecto de la perpendicular) deja de leer. El del navegador tolera
un poco más.

---

## Archivos

```
campori-qr/
├── index.html            menú y explicación
├── generador.html        genera e imprime QR de eventos
├── evaluador.html        app de escaneo
├── prueba-camara.html    para verificar la cámara de cada celular
├── sw.js                 hace que funcione sin señal
├── css/
│   ├── estilo.css        interfaz
│   └── impresos.css      lo que sale por la impresora (todo en milímetros)
├── js/
│   ├── catalogo.js       ← EVENTOS, PUNTAJES Y CLAVE. Es lo único que se edita.
│   ├── clubes.js         padrón, generado desde el Excel. No editar a mano.
│   ├── codigo.js         formato y firma de los QR
│   ├── puntaje.js        las reglas. Función pura, sin estado.
│   ├── galois.js         aritmética GF(256) de Reed-Solomon
│   ├── qr-tablas.js      tablas del estándar QR, compartidas
│   ├── qr-encoder.js     genera los códigos QR desde cero
│   ├── qr-decoder.js     los lee desde la imagen de la cámara (para iPhone)
│   ├── escaner.js        cámara, elección de motor, sonido y vibración
│   ├── almacen.js        guardado local (IndexedDB)
│   ├── exportar.js       escritor de .xlsx y CSV
│   ├── sheets.js         envío y consulta de seriales en Google Sheets
│   ├── generador.js      lógica del generador
│   └── evaluador.js      lógica del evaluador
└── herramientas/
    ├── generar-clubes.mjs  regenera clubes.js desde el Excel
    ├── apps-script.gs       se instala dentro de la planilla de Google
    ├── servidor.mjs        servidor local para probar
    └── pruebas*.mjs        las pruebas
```

### Comandos

Regenerar el padrón si cambia `LISTAS GENERALES.xlsx`:

```bash
node herramientas/generar-clubes.mjs
```

Correr todas las pruebas:

```bash
node herramientas/pruebas.mjs
```

Levantar el servidor local:

```bash
node herramientas/servidor.mjs
```

---

## Cómo está armado

**El puntaje no se guarda nunca.** Lo único que se almacena de cada escaneo es el
texto del QR y a qué club se le cargó. El puntaje se recalcula siempre con
`js/puntaje.js`. Si hay que corregir una regla a mitad del campori, se cambia ahí y
todos los resultados se rehacen solos, sin tocar los datos.

**Qué lleva cada QR.** `F03-7K9M2Q8R`: código del evento e identificador aleatorio
único. El puntaje no viaja en el QR: se obtiene del catálogo de la aplicación.

**Por qué el serial.** Es lo que convierte cada sticker en una pieza única. Sin él
se puede detectar un evento repetido, pero no una fotocopia ni un sticker prestado
entre clubes.

**Por qué 15 mm.** El código se imprime como QR versión 2 (25×25 módulos), con
corrección de error nivel H y el módulo oscuro obligatorio validado. Es la máxima
redundancia disponible y conserva el patrón de alineación para leerlo inclinado.

---

## Las pruebas

406 comprobaciones, sin framework:

- **Núcleo** — la firma coincide con `crypto` de Node; se rechazan QR alterados en
  cualquier campo; el motor de puntaje cumple las reglas y detecta cada trampa.
- **Generador de QR** — el formato y la información de versión se comparan contra
  las tablas publicadas de la norma ISO/IEC 18004. Además cada código se decodifica
  de vuelta leyendo la matriz como lo haría un escáner, y se verifican los síndromes
  de Reed-Solomon: si dan cero, la corrección de errores es matemáticamente correcta.
  Esta prueba encontró un polinomio generador invertido que habría producido mil
  stickers que ningún celular podía leer.
- **Lector de QR** — el que usan los iPhone. Se generan imágenes sintéticas y se les
  aplican a propósito las degradaciones que aparecen en la mano de una persona:
  desenfoque, rotación, perspectiva, ruido, contraste bajo, iluminación despareja,
  reflejo del papel autoadhesivo, rayones y basura alrededor del código. La cámara
  prioriza el QR más cercano a la mira, pero vuelve a mirar el campo completo si no
  encuentra uno allí. También se comprueban los QR de todos los eventos actuales. Además se
  corrompen bloques a propósito para comprobar que la corrección de errores recupera
  hasta 11 bytes rotos y que **nunca inventa datos** cuando el daño la supera.
- **Exportación** — el `.xlsx` se vuelve a abrir y se comprueba que los CRC del zip
  y los datos (acentos, comillas, números, celdas vacías) estén intactos.
- **PDF de stickers** — comprueba oficio de 215 × 330 mm con 204 QR, carta de
  216 × 281,5 mm con 168 QR, dibujo vectorial, estructura `xref` y longitudes.
- **Google Sheets** — verifica que varios evaluadores puedan actualizar clubes
  distintos sin pisarse y que los seriales con más de un club se conserven completos.
- **Escenario completo** — una ficha realista del club de prueba `ediquin`, con sus
  errores y sus cinco trampas. Imprime un informe legible de qué hace el sistema en
  cada caso.
