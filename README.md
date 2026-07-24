# Campori QR — sistema de puntajes

Evaluación de clubes de Aventureros escaneando códigos QR con el celular.
Se imprimen stickers con QR, los clubes los pegan en su ficha, y al final se
escanean las fichas para armar el puntaje y exportarlo a Excel.

**Sin dependencias, sin compilación, sin servidor.** Son archivos HTML, CSS y
JavaScript que el navegador abre tal cual. Funciona sin señal.

📖 **[Manual de uso → LEEME.md](LEEME.md)** · 🔧 **[Decisiones de diseño → ARQUITECTURA.md](ARQUITECTURA.md)**

---

## Las páginas

| | Para qué |
|---|---|
| [`index.html`](index.html) | Menú y explicación general |
| [`generador.html`](generador.html) | Genera e imprime únicamente los QR de los eventos |
| [`evaluador.html`](evaluador.html) | Escanea las fichas con la cámara y arma el puntaje |
| [`kit-prueba.html`](kit-prueba.html) | Ensayo completo con trampas incluidas, antes del campori |
| [`prueba-camara.html`](prueba-camara.html) | Verifica que la cámara de cada celular lea bien |

## Las reglas

| Bloque | Eventos | Puntos c/u | Regla | Máximo |
|---|---|---|---|---|
| Físicos | 14 disponibles | 200 | Cuentan los 8 primeros escaneados | 1600 |
| Espirituales | 7 | 200 | Los 7 son obligatorios | 1400 |
| **Base** | | | | **3000** |
| Adicional | 29 eventos | 100 | Cada evento cuenta una vez, aparte del puntaje base | — |

Cada sticker lleva un identificador aleatorio único, así que el sistema detecta
eventos repetidos, stickers fotocopiados y stickers prestados entre clubes.

## Correrlo localmente

```bash
node herramientas/servidor.mjs      # http://localhost:8080
node herramientas/pruebas.mjs       # 375 comprobaciones
node herramientas/generar-clubes.mjs  # regenera el padrón desde el Excel
```

No hace falta `npm install`: el proyecto no tiene dependencias.

## Publicarlo

Cualquier hosting estático sirve. Con GitHub Pages: `Settings → Pages → Deploy from
branch → main → / (root)`. Todas las rutas son relativas, así que funciona igual en
un subdirectorio.

**La cámara necesita HTTPS.** Es el único requisito real: sin eso el navegador la
bloquea. `localhost` también cuenta como seguro, para probar en la computadora.

## Antes de usarlo en serio

No hay que configurar inventarios ni claves. Cada vez que se generan hojas, todos
los QR reciben identificadores nuevos. El puntaje se toma del catálogo de eventos,
no del texto contenido en el QR.

## Datos personales

El padrón publicado (`js/clubes.js`) tiene nombre de club, región, iglesia y distrito.
**No incluye los nombres de los directores** a propósito, porque este repositorio es
público. El Excel original de inscripciones, que sí tiene nombres y teléfonos, está en
`.gitignore` y nunca se sube.
