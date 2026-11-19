// Utilidades de imagen: corrige orientación, reduce tamaño y recorta retratos.
// Las fotos se guardan comprimidas (JPEG) para caber en Firestore (máx. 1 MB por documento).

async function cargarBitmap(archivo) {
  try {
    return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(archivo);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function dibujar(fuente, maxLado, filtro) {
  const w = fuente.width || fuente.naturalWidth;
  const h = fuente.height || fuente.naturalHeight;
  const escala = Math.min(1, maxLado / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * escala);
  canvas.height = Math.round(h * escala);
  const ctx = canvas.getContext('2d');
  if (filtro) ctx.filter = filtro;
  ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const aJpeg = (canvas, calidad) => canvas.toDataURL('image/jpeg', calidad);

/**
 * Foto de un documento lista para usar.
 * @returns {{dataUrl: string, ocrCanvas: HTMLCanvasElement, colorCanvas: HTMLCanvasElement}}
 *   dataUrl: versión comprimida para guardar · ocrCanvas: en grises y contraste, para el OCR ·
 *   colorCanvas: a color y en buena resolución, para buscar el rostro.
 */
export async function procesarFoto(archivo) {
  const bmp = await cargarBitmap(archivo);
  const colorCanvas = dibujar(bmp, 1800);
  const ocrCanvas = dibujar(colorCanvas, 1800, 'grayscale(1) contrast(1.35)');
  const guardada = dibujar(colorCanvas, 1100);
  if (bmp.close) bmp.close();
  return { dataUrl: aJpeg(guardada, 0.72), ocrCanvas, colorCanvas };
}

/** Canvas a color (máx. 1200 px) de una foto cualquiera, p. ej. un retrato tomado con la cámara. */
export async function cargarCanvas(archivo, maxLado = 1200) {
  const bmp = await cargarBitmap(archivo);
  const canvas = dibujar(bmp, maxLado);
  if (bmp.close) bmp.close();
  return canvas;
}

export const RETRATO_W = 300;
export const RETRATO_H = 400;

/** Recorta la caja {x, y, w, h} del canvas y la deja como retrato 3:4 en JPEG. */
export function recortarRetrato(canvas, caja) {
  const salida = document.createElement('canvas');
  salida.width = RETRATO_W;
  salida.height = RETRATO_H;
  const ctx = salida.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, RETRATO_W, RETRATO_H);
  ctx.drawImage(canvas, caja.x, caja.y, caja.w, caja.h, 0, 0, RETRATO_W, RETRATO_H);
  return aJpeg(salida, 0.78);
}

/** Retrato 3:4 recortado del centro (cuando no se encuentra un rostro). */
export function recorteCentrado(canvas) {
  const W = canvas.width, H = canvas.height;
  let w = W, h = (W * 4) / 3;
  if (h > H) { h = H; w = (H * 3) / 4; }
  return recortarRetrato(canvas, { x: (W - w) / 2, y: (H - h) / 2, w, h });
}
