# Arquitectura y decisiones de diseño

Documento técnico. Explica **por qué** el sistema es como es, no solo qué hace.
Para el manual de uso ver [LEEME.md](LEEME.md); para el panorama general, [README.md](README.md).

Está escrito para que alguien que no participó del desarrollo —persona o agente—
pueda entender el sistema, discutirlo y criticarlo con fundamento. Las secciones
**Límites conocidos** y **Dónde están los riesgos** son las que más rinden si el
objetivo es dar feedback.

---

## 1. Qué problema resuelve

Un campori de aventureros con **71 clubes**. Cada club recorre estaciones de juegos;
al completar una, el juez le entrega un sticker con código QR que el club pega en su
ficha de papel. Al final, un equipo de evaluadores escanea esas fichas con el celular
y el sistema arma el puntaje.

Reglas del puntaje:

| Bloque | Eventos | Puntos c/u | Regla | Máximo |
|---|---|---|---|---|
| Físicos | 14 disponibles | 200 | Cuentan los **8 primeros escaneados** | 1600 |
| Espirituales | 7 | 200 | Los 7 son obligatorios | 1400 |
| **Base** | | | | **3000** |
| Adicional | criterios sueltos | 100 / 50 | Fuera del tope base | — |

No hay rúbrica ni puestos: participar vale 200, siempre. Ningún evento puede
repetirse.

---

## 2. Restricciones que moldearon el diseño

Estas tres explican casi todas las decisiones raras del proyecto:

1. **La máquina de desarrollo no tiene Node ni Python en el PATH.** No hay
   `npm install`, no hay paso de compilación, no hay bundler. Todo tiene que
   funcionar como archivos que el navegador abre tal cual.
2. **En el campamento la señal es poco confiable.** El sistema tenía que poder
   funcionar sin internet. Ver la sección 7: el usuario terminó decidiendo operar
   *con* internet, pero la capacidad offline se conservó como red de seguridad.
3. **El equipo de evaluación usa sus propios celulares**, Android y iPhone
   mezclados, con navegadores distintos.

Consecuencia directa: **cero dependencias**. Lo que normalmente sería una librería
está escrito acá adentro. Eso incluye el generador de QR, el lector de QR, el
escritor de `.xlsx` y la compatibilidad HMAC-SHA256 con QR antiguos. La sección 9 muestra que
esas piezas están mejor verificadas de lo que suele estarlo el código de pegamento
alrededor de una librería.

---

## 3. Decisiones y por qué

### 3.1 Qué lleva cada código QR

```
F03-7K9M2Q8R
 │       └──── identificador aleatorio único de ese sticker
 └──────────── código del evento
```

**La propuesta original era que el QR solo dijera el puntaje** ("un QR de 200 puntos").
Se descartó por dos razones, y la segunda es la que importa:

- Cualquiera genera un QR que diga `200` con el celular en diez segundos.
- **Sin saber de qué evento vino el sticker, la regla "no se puede repetir evento"
  es imposible de verificar.** Dos stickers que dicen 200 son indistinguibles.

El **serial** es lo que convierte cada sticker en una pieza única. Sin él se puede
detectar un evento repetido, pero no una fotocopia ni un sticker prestado entre
clubes.

Detalles de formato, todos con motivo:

- **Solo `0-9`, `A-Z` y `-`**, que es el juego alfanumérico del estándar QR.
  El contenido operativo tiene 12 caracteres: `F03-7K9M2Q8R`.
- **Base32 de Crockford** para el identificador aleatorio: sin `I`, `L`, `O` ni `U`.
- Se fuerza un símbolo **versión 2** (25×25 módulos) con corrección **nivel H**.
  La versión 2 conserva un patrón de alineación que ayuda al lector cuando el
  teléfono está inclinado.
- A **26 mm impreso**, queda margen para que el sticker
  quede arrugado o manchado.

### 3.2 Por qué no hay backend

No hay servidor propio. La app entera corre dentro del navegador del celular.

- **GitHub Pages es un estante, no un servicio.** Sirve archivos; no recibe nada.
- Un service worker guarda los 26 archivos de la app. Después de la primera visita,
  **la app abre con el teléfono en modo avión**. Verificado, no supuesto.
- Los datos viven en **IndexedDB**, dentro del teléfono.

Costo cero, cero infraestructura que mantener, y nada que se caiga el día del evento.

### 3.3 El puntaje no se guarda: se recalcula

**Esta es la decisión de diseño más importante del proyecto.**

De cada escaneo se guarda únicamente:

```js
{ idClub, crudo, ts, dispositivo }   // clave compuesta: [idClub, crudo]
```

`crudo` es el texto del QR tal como salió de la cámara. **El puntaje no se almacena
en ningún lado.** Se deriva siempre con [`js/puntaje.js`](js/puntaje.js), que es una
función pura sin estado ni acceso al almacenamiento.

Qué compra eso:

- Si una regla resulta estar mal a mitad del campori, se cambia en
  [`js/catalogo.js`](js/catalogo.js) y **todos los resultados se rehacen solos**, sin
  migrar datos ni reescanear nada.
- La pantalla, el resumen y el Excel no pueden mostrar números distintos: los tres
  llaman a la misma función.
- Los datos guardados son irrefutables: es lo que la cámara leyó.

La clave compuesta `[idClub, crudo]` hace que escanear dos veces el mismo sticker en
la misma ficha no cree dos registros — lo rechaza la base de datos, no el código.

### 3.4 Lector de QR propio

Safari en iPhone **no tiene `BarcodeDetector`**, la API que usan Chrome y Edge. Sin
alternativa, los iPhone del equipo no podrían escanear.

En vez de vendorizar una librería, se escribió [`js/qr-decoder.js`](js/qr-decoder.js).
[`js/escaner.js`](js/escaner.js) elige el motor solo:

| Navegador | Motor | Costo por cuadro |
|---|---|---|
| Chrome / Edge | `BarcodeDetector` nativo | acelerado por hardware |
| Safari / iPhone | lector propio | 5 ms (sintético) / 7–35 ms (navegador real) |

El recorrido del lector propio: escala de grises → binarizado adaptativo por bloques
→ ubicar los tres cuadrados de las esquinas (por filas y por columnas) → corregir la
perspectiva con una homografía de 4 puntos → muestrear la cuadrícula → leer el formato
→ quitar la máscara → desintercalar bloques → **corregir errores con Reed-Solomon**
(Berlekamp-Massey + Chien + Forney) → leer el texto.

### 3.5 Escritor de `.xlsx` propio

Un `.xlsx` es un ZIP con XML adentro. [`js/exportar.js`](js/exportar.js) lo arma a
mano, guardando las entradas **sin comprimir** (método *stored*): es perfectamente
válido y evita implementar deflate. Los archivos salen más grandes que los de Excel,
pero hablamos de kilobytes.

---

## 4. Las capas contra duplicados, y qué caza cada una

Están puestas en cascada. Cada una tapa un agujero distinto:

| Capa | Qué detecta | Qué NO detecta |
|---|---|---|
| **Clave compuesta en la base** | El mismo sticker escaneado dos veces en la misma ficha | — |
| **Evento ya contado** | Dos stickers distintos del mismo evento | — |
| **Cupo de 8 físicos** | Más eventos de los permitidos | — |
| **Seriales usados por otros** | Sticker despegado de una ficha y pegado en otra | Ver 4.2 |

### 4.1 Formato operativo simple

Los stickers nuevos no llevan firma ni inventario. Cada QR contiene solamente el
código del evento y ocho caracteres aleatorios. El generador evita repetirlos dentro
del navegador y la probabilidad de coincidencia entre equipos es despreciable para
el volumen del campori. Los QR firmados antiguos siguen siendo compatibles.

### 4.2 La capa que depende de juntar los datos

Un teléfono solo conoce las fichas que escaneó **ese** teléfono. Si el club A le
prestó un sticker al club B, y esos dos clubes los evaluaron personas distintas,
ninguno de los dos celulares lo ve.

La solución compartida es **Google Sheets**: cada teléfono publica el detalle de sus
escaneos y baja la lista de todos los clubes donde aparece cada sticker
(`?accion=seriales`). Si un serial figura en dos clubes, ambos quedan en conflicto y
ese sticker suma 0 hasta que los responsables aclaren el incidente.

Sin enviar y traer, esa trampa pasa. Está medido: sin traer, el club queda con 600
puntos y cero alertas; después de traer, 400 puntos y una alerta grave que nombra al
otro club.

---

## 5. Modelo de datos

### IndexedDB (`campori-qr`, versión 1)

| Almacén | Clave | Contenido |
|---|---|---|
| `escaneos` | `[idClub, crudo]` | `{ idClub, crudo, ts, dispositivo }` — índices por `idClub` y por `crudo` |
| `fichas` | `idClub` | `{ idClub, cerrada, actualizada }` |
| `ajustes` | `clave` | nombre del dispositivo, config de Sheets y seriales remotos |

### Padrón de clubes

[`js/clubes.js`](js/clubes.js) es **generado**, no se edita a mano. Sale de
`LISTAS GENERALES.xlsx` con
[`herramientas/generar-clubes.mjs`](herramientas/generar-clubes.mjs).

Ese Excel es la planilla de pagos: **una fila por comprobante, no por club**. 165
filas → 71 clubes reales. El script deduplica normalizando (sin tildes, sin
puntuación, mayúsculas) y elige la variante mejor escrita de cada nombre.

Trampas reales que tiene ese archivo y que el script maneja:

- El mismo club repetido hasta 7 veces (`Guardianes`), una fila por pago.
- Mayúsculas inconsistentes: `Messenger` / `MESSENGER`, `CHICANI` / `Chicani`.
- **Filas con las columnas corridas.** Una deja a `RAHAM` en la "Región 199" con
  iglesia "29". Por eso el desempate prefiere valores que *contienen letras* y
  regiones con el formato esperado.
- Filas de basura al final (totales sueltos, números sin club).

**No incluye nombres de directores.** El repositorio es público y son datos
personales de 71 personas. La app no los necesita: el club se identifica con nombre,
región e iglesia. Se pueden incluir con `--con-directores` si el despliegue es
privado.

---

## 6. El motor de puntaje

[`js/puntaje.js`](js/puntaje.js), función `calcular(escaneos, opciones)`. Pura: mismas
entradas, mismas salidas, sin efectos.

Cada escaneo termina en exactamente uno de estos estados:

| Estado | Nivel | Suma |
|---|---|---|
| `contado` | ok | sí |
| `club` | info | no — es el QR de cabecera de la ficha |
| `repetido` | alerta | no |
| `excedente` | aviso | no — pasó el cupo de 8 |
| `serial_repetido` | alerta | no — el mismo sticker dos veces |
| `serial_ajeno` | alerta | no — ya lo usó otro club |
| `desconocido` | alerta | no — código fuera del catálogo |
| `invalido` | alerta | no — firma mala o formato ilegible |

**El orden de las comprobaciones importa** y está fijado a propósito:

1. Firma y formato
2. ¿Es el QR de un club? → cambia de ficha, no suma
3. ¿Está el evento en el catálogo?
4. ¿Ya escaneamos este serial en esta ficha?
5. ¿Lo usó otro club?
6. ¿Ya contamos este evento?
7. ¿Se llenó el cupo de 8 físicos?

Un detalle sutil verificado por prueba: **un evento repetido no consume cupo**. Si un
club pega F01 dos veces y después 7 eventos más, llega igual a los 8 que le
corresponden.

Las alertas se ordenan por gravedad. La primera versión ponía "faltan espirituales"
—que le aparece a casi toda ficha a medio evaluar— por encima de un sticker robado.
Lo detectó una prueba.

---

## 7. La ruta compartida de datos

**No existe sincronización automática entre teléfonos.** Nunca, ni con internet. No
se envía información sin una acción del evaluador; los escaneos se guardan primero
en el teléfono y Google Sheets actúa como la base compartida cuando hay conexión.

```
   celu 1 ──envía lo suyo──┐                    ┌──▶ celu 1 trae los seriales
                           ├──▶ Google Sheets ──┤
   celu 2 ──envía lo suyo──┘                    └──▶ celu 2 trae los seriales

   Ajustes → Enviar mis puntajes / Traer lo de los demás
```

Sin señal, cada teléfono continúa evaluando con IndexedDB. Al recuperar conexión,
envía lo pendiente y trae los seriales compartidos. El detalle de escaneos es
obligatorio: sin el QR completo no se puede detectar un sticker repetido entre
clubes.

### Cómo conviven varios teléfonos en la misma planilla

Tres decisiones que hacen que esto funcione, y las tres nacieron de un fallo real:

1. **Cada teléfono manda solo los clubes que evaluó.** La versión anterior mandaba
   todo el padrón; los no evaluados iban con cero y **pisaban el trabajo del otro
   evaluador**. Hay una prueba que reproduce ese fallo explícitamente para que no
   vuelva.
2. **El script fusiona por ID de club**, no reemplaza la hoja. Reemplaza las filas de
   los clubes que vienen y deja el resto intacto. El orden de llegada no cambia el
   resultado; reenviar no duplica.
3. **El script toma un cerrojo** (`LockService`) mientras escribe. Sin él, dos envíos
   simultáneos leerían la planilla vieja y el último en terminar borraría al otro.

### Detalle de implementación fácil de pisar

El cuerpo del POST va como **`text/plain`**, no `application/json`. Con JSON el
navegador exige una consulta previa de permisos (*preflight* `OPTIONS`) que Apps
Script no sabe responder, y el envío falla sin dar ninguna explicación útil. Del otro
lado se parsea como JSON igual. Está comentado en
[`js/sheets.js`](js/sheets.js) y en [`herramientas/apps-script.gs`](herramientas/apps-script.gs)
porque es exactamente el tipo de cosa que alguien "limpia" y rompe.

---

## 8. Mapa de archivos

```
Páginas
  index.html            menú
  generador.html        genera e imprime QR de eventos
  evaluador.html        app de escaneo
  kit-prueba.html       ensayo completo con trampas incluidas
  prueba-camara.html    diagnóstico de cámara por dispositivo

Núcleo (el orden importa: de arriba abajo, cada uno usa a los de arriba)
  js/catalogo.js        EVENTOS, PUNTAJES Y CLAVE. Lo único pensado para editar.
  js/clubes.js          padrón generado. No editar a mano.
  js/galois.js          aritmética GF(256) de Reed-Solomon
  js/qr-tablas.js       tablas del estándar QR, compartidas encoder/decoder
  js/codigo.js          formato y firma de los QR, con caché de lecturas
  js/puntaje.js         las reglas. Función pura.
  js/qr-encoder.js      genera los símbolos QR
  js/qr-decoder.js      los lee desde la imagen de la cámara
  js/escaner.js         cámara, elección de motor, sonido y vibración
  js/almacen.js         IndexedDB
  js/exportar.js        escritor de .xlsx y CSV
  js/sheets.js          envío y lectura contra Google Sheets

Interfaz
  js/generador.js  js/evaluador.js  js/kit-prueba.js
  css/estilo.css        pantalla
  css/impresos.css      papel. TODO en milímetros: el resultado es físico.

Herramientas (Node, sin dependencias)
  herramientas/generar-clubes.mjs   regenera el padrón desde el Excel
  herramientas/servidor.mjs         servidor local, con --subruta para imitar Pages
  herramientas/apps-script.gs       se pega DENTRO de Google Sheets
  herramientas/pruebas*.mjs         las pruebas
```

---

## 9. Estrategia de pruebas

`node herramientas/pruebas.mjs` — **368 comprobaciones**, sin framework.

El criterio: cada suite tiene que probar contra algo **independiente**, no contra sí
misma.

| Suite | Contra qué verifica |
|---|---|
| `pruebas-nucleo.mjs` | La firma se compara contra `crypto` de Node. Las reglas, contra escenarios escritos a mano. |
| `pruebas-qr.mjs` | Formato e información de versión contra las **tablas publicadas de ISO/IEC 18004**. Cada código se decodifica leyendo la matriz como un escáner, y se verifican los **síndromes de Reed-Solomon**: si dan cero, la corrección es matemáticamente correcta. |
| `pruebas-decoder.mjs` | Imágenes sintéticas con degradaciones deliberadas y geometría del recorte central que excluye QR vecinos. La perspectiva se aplica con una homografía resuelta por **eliminación gaussiana**, método distinto del que usa el lector: si compartieran implementación, un error se cancelaría. |
| `pruebas-exportar.mjs` | El `.xlsx` se reabre y se comprueban los **CRC del ZIP** y los datos (acentos, comillas, signos de XML, números, celdas vacías). |
| `pruebas-sheets.mjs` | La regla de fusión, incluido el caso que rompía (mandar clubes no evaluados), y que un serial presente en dos clubes deje a ambos en conflicto. |
| `pruebas-escenario.mjs` | Una ficha realista del club `ediquin` con sus cinco trampas. Imprime un informe legible. |

### Fallos reales que encontraron

No son hipotéticos. Cada uno habría causado un problema concreto:

- **Polinomio generador de Reed-Solomon invertido.** Los QR se veían perfectos y
  **ningún celular los habría leído**. Se habría descubierto con mil stickers
  impresos.
- **Información de versión BCH con el polinomio de 10 bits en vez de 13.**
- **Tres bugs en el lector**: límite del chequeo vertical mal calculado (no
  decodificaba nada), redondeo del tamaño que convertía un 25 válido en 27, y el
  centro del patrón de alineación tomado del hueco claro en vez del punto oscuro.
- **Binarizado que asumía negro ≈ 0**, y convertía tinta pálida en papel.
- **Alertas graves ordenadas debajo de los avisos rutinarios.**
- **`usadosPorOtros` borraba justo la evidencia del robo** que acababa de traer de
  la planilla.
- **Un error en la propia prueba**: la función que simulaba inclinación no era una
  perspectiva real, así que ninguna homografía podía deshacerla. Exigía lo imposible.

---

## 10. Límites conocidos

Todos medidos, no estimados:

| Límite | Valor | Impacto |
|---|---|---|
| Inclinación del lector propio | deja de leer más allá de **~45°** respecto de la perpendicular | Solo iPhone. Está anotado como prueba, así que si mejora o empeora, avisa. |
| Versiones QR soportadas | 1 a 10 | Nuestros códigos son versión 2. Sobra. |
| Desfase de relojes | no se corrige | La regla de "los 8 primeros" usa la hora del escaneo. Con relojes desfasados el orden puede salir mal. Solo se avisa. |
| Copia de QR | no se intenta impedir | La operación prioriza rapidez; los duplicados sí se detectan. |
| Detección entre clubes | requiere juntar datos | Ver 4.2. |

---

## 11. Dónde están los riesgos

Si el objetivo es dar feedback, mirar acá primero:

1. **Los QR operativos se pueden copiar o fabricar.** Es una decisión explícita para
   simplificar la preparación; el sistema se concentra en sumar y detectar duplicados.
2. **Los criterios de puntaje adicional son de ejemplo.** `CRITERIOS_ADICIONALES` en
   [`js/catalogo.js`](js/catalogo.js) tiene valores inventados que hay que reemplazar.
3. **Cambiar un código de evento invalida los stickers ya impresos.** Agregar al
   final es seguro; renumerar no.
4. **La URL del Apps Script es efectivamente una contraseña.** Quien la tenga puede
   escribir en la planilla. Por eso se guarda en el teléfono y nunca en el repo.
5. **La ruta de Sheets depende de que alguien se acuerde de "Traer lo de los demás".** Se
   hace solo al abrir la app, pero si un evaluador la deja abierta todo el día, sus
   datos remotos envejecen. Un fallo silencioso: no se rompe nada, simplemente deja
   de detectar.
6. **El desfase de relojes no tiene defensa**, solo un aviso en Ajustes.

---

## 12. Cómo extenderlo sin romperlo

- **Cambiar reglas o puntajes**: solo [`js/catalogo.js`](js/catalogo.js). Como el
  puntaje se recalcula siempre, no hay que migrar nada.
- **Agregar eventos**: al final de la lista, con códigos nuevos.
- **Cambiar el padrón**: editar el Excel y correr
  `node herramientas/generar-clubes.mjs`. Nunca editar `js/clubes.js` a mano.
- **Tocar el encoder o el decoder de QR**: correr `pruebas-qr.mjs` y
  `pruebas-decoder.mjs`. Los síndromes de Reed-Solomon son el guardián: si dan
  distinto de cero, algo se rompió.
- **Tocar el envío a Sheets**: `pruebas-sheets.mjs` cubre la regla de fusión, pero
  no la implementación real de Apps Script (corre dentro de Google). Si se cambia
  una, hay que cambiar la otra.
- **Agregar archivos**: sumarlos a la lista de [`sw.js`](sw.js) y **subir el número
  de versión del caché**, o los celulares seguirán con la copia vieja.
