// OCR en el navegador con Tesseract.js (se descarga solo la primera vez que se usa).
// Las fotos no salen del dispositivo para ser leídas: el reconocimiento es local.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let cargaLib = null;
let worker = null;
let alProgreso = () => {};

function cargarLibreria() {
  if (window.Tesseract) return Promise.resolve();
  cargaLib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = resolve;
    s.onerror = () => {
      cargaLib = null;
      reject(new Error('No se pudo cargar el lector de texto. Revisa tu conexión a internet.'));
    };
    document.head.appendChild(s);
  });
  return cargaLib;
}

async function obtenerWorker() {
  if (worker) return worker;
  await cargarLibreria();
  worker = await window.Tesseract.createWorker('spa', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') alProgreso(m.progress);
      else alProgreso(null, m.status);
    },
  });
  return worker;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {(progreso: number|null, estado?: string) => void} cb
 * @returns {Promise<string>} texto reconocido
 */
export async function reconocerTexto(canvas, cb = () => {}) {
  alProgreso = cb;
  const w = await obtenerWorker();
  const { data } = await w.recognize(canvas);
  return data.text || '';
}
