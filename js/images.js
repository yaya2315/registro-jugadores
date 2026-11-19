// Utilidades de imagen: corrige orientación, reduce tamaño y genera miniaturas.
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

/** Devuelve la foto lista para guardar y un canvas optimizado para el OCR. */
export async function procesarFoto(archivo) {
  const bmp = await cargarBitmap(archivo);
  const guardada = dibujar(bmp, 1100);
  const paraOcr = dibujar(bmp, 1800, 'grayscale(1) contrast(1.35)');
  if (bmp.close) bmp.close();
  return { dataUrl: aJpeg(guardada, 0.72), ocrCanvas: paraOcr };
}

/** Miniatura cuadrada pequeña para la lista (guardada dentro del documento principal). */
export async function miniaturaDesde(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const lado = 120;
  const canvas = document.createElement('canvas');
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext('2d');
  const recorte = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - recorte) / 2, (img.height - recorte) / 2, recorte, recorte, 0, 0, lado, lado);
  return aJpeg(canvas, 0.6);
}
