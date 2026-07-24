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
| Adicional | criterios sueltos | 100 / 50 | Suma **aparte** del puntaje base | — |

No hay rúbrica ni puestos: el club que hace un evento suma 200, siempre.

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

Abrí `js/catalogo.js` y cambiá dos cosas:

```js
clave: 'aventuri-2026-de-vuelta-a-casa',   // ← poné una frase propia
```

Esa clave firma los códigos QR. **Cambiala antes de imprimir** y no la publiques.
Si la cambiás después de imprimir, los stickers ya impresos dejan de validar.

Más abajo, `CRITERIOS_ADICIONALES` son de ejemplo. Reemplazalos por los reales
(seguridad, limpieza de baños, lo que corresponda). Solo pueden valer 100 o 50.

### 2. Imprimir

Abrí `generador.html`:

Elegí los eventos y cuántos QR necesitás por evento (80 alcanza: son 71 clubes).
Cada hoja A4 trae 56 stickers de 26 mm de un mismo evento, listos para recortar y
darle al juez de esa estación. La página no genera fichas ni pide inventarios.
Cada nueva generación crea identificadores aleatorios distintos.

Papel: cualquier hoja autoadhesiva A4. Imprimí **al 100%, sin "ajustar a página"**,
o los 26 mm dejan de ser 26 mm.

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

Google Sheets es la única vía compartida. Cada teléfono guarda primero sus escaneos
en forma local, así que puede seguir evaluando sin señal. Cuando recupera conexión:

1. **Enviar mis puntajes** publica los clubes evaluados y todo el detalle de QR.
2. **Traer lo de los demás** actualiza la lista de stickers usados por otros clubes.

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
5. Copiá la dirección que termina en `/exec` y pegala en la app, en
   `Ajustes → Enviar a Google Sheets`, junto con la misma clave.

Cada teléfono manda **solo los clubes que evaluó**, junto con el detalle completo de
sus escaneos. En la planilla se fusionan por club: se reemplazan esas filas y se deja
intacto todo lo demás. Por eso pueden mandar varios evaluadores sin pisarse y cada
uno puede reenviar sin duplicar nada. La hoja `Envíos` deja constancia de quién mandó
qué y cuándo.

La dirección y la clave se guardan **en el teléfono**, nunca en el repositorio. Quien
tenga esa dirección puede escribir en tu planilla, así que no la publiques.

#### Traer lo de los demás — no te lo saltees

El botón **Traer lo de los demás** baja la lista de stickers y todos los clubes donde
aparece cada uno. Es lo que permite detectar un sticker despegado de una ficha y
pegado en otra cuando esos dos clubes los evaluaron personas distintas.

Sin eso, tu teléfono solo conoce las fichas que vos escaneaste, y esa trampa pasa sin
que nadie se entere. Se hace solo al abrir la app, pero **si dejás la app abierta
todo el día, tus datos envejecen**: tocá el botón cada tanto.

Cuando un QR aparece en dos clubes, ambos quedan con ese sticker en conflicto y
reciben 0 puntos. La decisión sobre el dueño legítimo se toma fuera de la app.

En `Ajustes` te dice cuántos stickers tenés y de cuándo son.

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

**Por qué 26 mm.** El código se imprime como QR versión 2 (25×25 módulos), con
corrección de error nivel H y el módulo oscuro obligatorio validado. Es la máxima
redundancia disponible y conserva el patrón de alineación para leerlo inclinado.

---

## Las pruebas

368 comprobaciones, sin framework:

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
- **Google Sheets** — verifica que varios evaluadores puedan actualizar clubes
  distintos sin pisarse y que los seriales con más de un club se conserven completos.
- **Escenario completo** — una ficha realista del club de prueba `ediquin`, con sus
  errores y sus cinco trampas. Imprime un informe legible de qué hace el sistema en
  cada caso.
