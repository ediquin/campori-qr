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
- **Sticker no impreso por nosotros** — firma válida pero serial fuera del inventario.
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

1. **Hojas de stickers.** Elegí los eventos y cuántos por evento (80 alcanza:
   son 71 clubes). Cada hoja A4 trae 63 stickers de 24 mm de un mismo evento,
   listos para recortar y darle al juez de esa estación.
2. **Descargá el inventario.** Es un `.json` con todos los seriales impresos.
   **Guardalo bien.** Si lo perdés no se puede reconstruir, y sin él la app no
   puede distinguir un sticker nuestro de uno fabricado por fuera.
3. **Fichas de evaluación.** Una hoja por club, con su QR en la cabecera.

Si imprimís en varias tandas, **cargá el inventario anterior antes de generar la
siguiente**: así los seriales continúan la numeración en vez de repetirse.

Papel: cualquier hoja autoadhesiva A4. Imprimí **al 100%, sin "ajustar a página"**,
o los 24 mm dejan de ser 24 mm.

### 3. Durante el campamento

Cada juez tiene el taco de stickers de su evento y le da uno al club que lo
completa. El club los pega en su ficha.

### 4. Evaluar

Abrí `evaluador.html` en el celular:

1. En **Ajustes**, cargá el inventario. Una sola vez por teléfono.
2. Elegí el club, o **escaneá el QR de la cabecera de la ficha** (más rápido).
3. Encendé la cámara y pasá cada sticker. Suena y vibra en cada escaneo:
   un tono ascendente si sumó, otro distinto si hay problema.
4. Tocá **Marcar ficha como terminada**.
5. En **Resultados**, **Descargar Excel**.

Si evalúan con varios celulares: exportá desde cada uno (Ajustes → Exportar mis
datos) e importá todo en el que vaya a generar la planilla final. Importar nunca
borra: solo agrega lo que falta.

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
├── generador.html        imprime stickers y fichas
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
│   ├── generador.js      lógica del generador
│   └── evaluador.js      lógica del evaluador
└── herramientas/
    ├── generar-clubes.mjs  regenera clubes.js desde el Excel
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

**Qué lleva cada QR.** `AV5-F03-200-0147-K7M2`: prefijo del campori, código del
evento, puntos, serial único y firma. Un QR que solo dijera "200" sería inútil —
cualquiera lo genera en diez segundos y, peor, no habría forma de saber de qué
evento vino, que es justo lo que hace falta para detectar repetidos.

**Por qué el serial.** Es lo que convierte cada sticker en una pieza única. Sin él
se puede detectar un evento repetido, pero no una fotocopia ni un sticker prestado
entre clubes.

**Sobre la firma.** Es HMAC-SHA256 truncada. No es inviolable: quien tenga el código
fuente puede generar un QR válido. Lo que realmente frena la falsificación es el
inventario de seriales — un QR bien firmado pero con un serial que no imprimimos
queda rechazado igual. Por eso importa guardar ese archivo.

**Por qué 24 mm.** El código entra en un símbolo QR versión 2 (25×25 módulos) con
corrección de error nivel Q, que tolera hasta un 25% de daño. A 24 mm cada módulo
mide 0,73 mm: más que suficiente para la cámara de un celular, y con margen para
que el sticker quede algo arrugado o manchado.

---

## Las pruebas

343 comprobaciones, sin framework:

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
  reflejo del papel autoadhesivo, rayones y basura alrededor del código. Además se
  corrompen bloques a propósito para comprobar que la corrección de errores recupera
  hasta 11 bytes rotos y que **nunca inventa datos** cuando el daño la supera.
- **Exportación** — el `.xlsx` se vuelve a abrir y se comprueba que los CRC del zip
  y los datos (acentos, comillas, números, celdas vacías) estén intactos.
- **Escenario completo** — una ficha realista del club de prueba `ediquin`, con sus
  errores y sus cinco trampas. Imprime un informe legible de qué hace el sistema en
  cada caso.
