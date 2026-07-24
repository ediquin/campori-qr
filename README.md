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
| [`generador.html`](generador.html) | Imprime las hojas de stickers y las fichas de cada club |
| [`evaluador.html`](evaluador.html) | Escanea las fichas con la cámara y arma el puntaje |
| [`kit-prueba.html`](kit-prueba.html) | Ensayo completo con trampas incluidas, antes del campori |
| [`prueba-camara.html`](prueba-camara.html) | Verifica que la cámara de cada celular lea bien |

## Las reglas

| Bloque | Eventos | Puntos c/u | Regla | Máximo |
|---|---|---|---|---|
| Físicos | 14 disponibles | 200 | Cuentan los 8 primeros escaneados | 1600 |
| Espirituales | 7 | 200 | Los 7 son obligatorios | 1400 |
| **Base** | | | | **3000** |
| Adicional | criterios sueltos | 100 / 50 | Aparte del puntaje base | — |

Cada sticker lleva un número de serie único y una firma, así que el sistema detecta
eventos repetidos, stickers fotocopiados y stickers prestados entre clubes.

## Correrlo localmente

```bash
node herramientas/servidor.mjs      # http://localhost:8080
node herramientas/pruebas.mjs       # 365 comprobaciones
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

1. **Cambiá la clave de firma** en [`js/catalogo.js`](js/catalogo.js) antes de
   imprimir. Es lo que hace que un QR sea nuestro y no de cualquiera.
El evaluador está en modo de **inventario automático**: no hay que cargar archivos
en los teléfonos. Todo QR con firma válida y evento conocido puede usarse por primera
vez con cualquier club.

## Datos personales

El padrón publicado (`js/clubes.js`) tiene nombre de club, región, iglesia y distrito.
**No incluye los nombres de los directores** a propósito, porque este repositorio es
público. El Excel original de inscripciones, que sí tiene nombres y teléfonos, está en
`.gitignore` y nunca se sube.
