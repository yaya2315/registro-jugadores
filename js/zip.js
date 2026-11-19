// Escritor de archivos ZIP sin dependencias (método "store", sin compresión).
// Las fotos ya vienen comprimidas (JPEG/WebP), así que comprimir otra vez no ahorraría casi nada.
// Los nombres se guardan en UTF-8, para que las tildes se vean bien al abrirlo.

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {{nombre: string, datos: Uint8Array|string}[]} entradas  nombre con "/" para carpetas
 * @param {Date} [fecha]
 * @returns {Blob}
 */
export function crearZip(entradas, fecha = new Date()) {
  if (entradas.length > 65000) throw new Error('Demasiados archivos para un ZIP simple.');
  const enc = new TextEncoder();
  const hora = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1);
  const dia = ((fecha.getFullYear() - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();

  const partes = [];
  const central = [];
  let desplazamiento = 0;

  for (const { nombre, datos } of entradas) {
    const bytes = typeof datos === 'string' ? enc.encode(datos) : datos;
    const nom = enc.encode(nombre);
    const crc = crc32(bytes);
    const largo = bytes.length;
    if (largo > 0xfffffff0 || desplazamiento > 0xfffffff0) throw new Error('El respaldo es demasiado grande para un ZIP simple.');

    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true);
    loc.setUint16(4, 20, true); // versión necesaria
    loc.setUint16(6, 0x0800, true); // nombres en UTF-8
    loc.setUint16(8, 0, true); // sin compresión
    loc.setUint16(10, hora, true);
    loc.setUint16(12, dia, true);
    loc.setUint32(14, crc, true);
    loc.setUint32(18, largo, true);
    loc.setUint32(22, largo, true);
    loc.setUint16(26, nom.length, true);
    loc.setUint16(28, 0, true);
    partes.push(loc.buffer, nom, bytes);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, hora, true);
    cen.setUint16(14, dia, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, largo, true);
    cen.setUint32(24, largo, true);
    cen.setUint16(28, nom.length, true);
    cen.setUint32(42, desplazamiento, true);
    central.push(cen.buffer, nom);

    desplazamiento += 30 + nom.length + largo;
  }

  const tamCentral = central.reduce((s, p) => s + p.byteLength, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, entradas.length, true);
  fin.setUint16(10, entradas.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, desplazamiento, true);

  return new Blob([...partes, ...central, fin.buffer], { type: 'application/zip' });
}
