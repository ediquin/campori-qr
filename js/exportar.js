// Exportacion a Excel (.xlsx) y a CSV.
//
// Un .xlsx es un zip con unos XML adentro. Lo armamos a mano porque el proyecto no
// tiene dependencias: guardamos las entradas sin comprimir (metodo "stored"), que es
// perfectamente valido y evita tener que implementar deflate. Los archivos salen mas
// grandes que los de Excel, pero hablamos de kilobytes.

// ------------------------------------------------------------------ zip

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function armarZip(entradas) {
  const codificador = new TextEncoder();
  const partes = [];
  const central = [];
  let desplazamiento = 0;

  const escribir = (largo, escritor) => {
    const b = new Uint8Array(largo);
    escritor(new DataView(b.buffer));
    return b;
  };

  for (const { nombre, contenido } of entradas) {
    const datos = typeof contenido === 'string' ? codificador.encode(contenido) : contenido;
    const nombreBytes = codificador.encode(nombre);
    const crc = crc32(datos);

    const cabecera = escribir(30, dv => {
      dv.setUint32(0, 0x04034b50, true);   // firma de cabecera local
      dv.setUint16(4, 20, true);           // version necesaria
      dv.setUint16(6, 0x0800, true);       // marca de nombres en UTF-8
      dv.setUint16(8, 0, true);            // metodo 0: sin comprimir
      dv.setUint32(14, crc, true);
      dv.setUint32(18, datos.length, true);
      dv.setUint32(22, datos.length, true);
      dv.setUint16(26, nombreBytes.length, true);
    });
    partes.push(cabecera, nombreBytes, datos);

    const entradaCentral = escribir(46, dv => {
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, 0, true);
      dv.setUint32(16, crc, true);
      dv.setUint32(20, datos.length, true);
      dv.setUint32(24, datos.length, true);
      dv.setUint16(28, nombreBytes.length, true);
      dv.setUint32(42, desplazamiento, true);
    });
    central.push(entradaCentral, nombreBytes);

    desplazamiento += cabecera.length + nombreBytes.length + datos.length;
  }

  const largoCentral = central.reduce((t, p) => t + p.length, 0);
  const fin = escribir(22, dv => {
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, entradas.length, true);
    dv.setUint16(10, entradas.length, true);
    dv.setUint32(12, largoCentral, true);
    dv.setUint32(16, desplazamiento, true);
  });

  return new Blob([...partes, ...central, fin], { type: 'application/zip' });
}

// ------------------------------------------------------------------ xlsx

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Excel rechaza el archivo si aparecen caracteres de control.
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

function letraColumna(n) {
  let s = '';
  n += 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function celda(valor, fila, col, encabezado) {
  const ref = `${letraColumna(col)}${fila}`;
  const estilo = encabezado ? ' s="1"' : '';
  if (valor === null || valor === undefined || valor === '') return `<c r="${ref}"${estilo}/>`;
  if (typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${ref}"${estilo}><v>${valor}</v></c>`;
  return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${esc(valor)}</t></is></c>`;
}

function hojaXml({ filas, anchos }) {
  const cols = anchos?.length
    ? `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const cuerpo = filas.map((fila, i) =>
    `<row r="${i + 1}">${fila.map((v, j) => celda(v, i + 1, j, i === 0)).join('')}</row>`
  ).join('');
  // La fila 1 queda congelada para recorrer todo el padrón sin perder los títulos.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${cols}<sheetData>${cuerpo}</sheetData></worksheet>`;
}

/**
 * Arma un .xlsx con una o varias hojas.
 * @param {Array<{nombre: string, filas: Array<Array>, anchos?: number[]}>} hojas
 *        La primera fila de cada hoja se toma como encabezado y sale en negrita.
 */
export function aXlsx(hojas) {
  const relsHojas = hojas.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('');

  const entradas = [
    {
      nombre: '[Content_Types].xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`,
    },
    {
      nombre: '_rels/.rels',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      nombre: 'xl/workbook.xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${hojas.map((h, i) => `<sheet name="${esc(h.nombre).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relsHojas}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      nombre: 'xl/styles.xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
    },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: hojaXml(h) })),
  ];

  return armarZip(entradas);
}

/** CSV con BOM, para que Excel respete los acentos al abrirlo de un doble clic. */
export function aCsv(filas) {
  const campo = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texto = filas.map(f => f.map(campo).join(';')).join('\r\n');
  return new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' });
}

/** Dispara la descarga de un Blob con el nombre indicado. */
export function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
