// OCR en el navegador con Tesseract.js (se descarga solo la primera vez que se usa).
// Las fotos no salen del dispositivo para ser leídas: el reconocimiento es local.
//
// Cada documento se lee DOS veces:
//   1) texto completo (nombres, apellidos, fechas...)
//   2) solo dígitos, en modo "texto disperso": encuentra el número aunque esté sobre
//      un fondo con diseño, que es donde la lectura normal suele fallar.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

const MODO_AUTO = '3';
const MODO_DISPERSO = '11';

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
    logger: (m) => alProgreso(m.status === 'recognizing text' ? m.progress : null),
  });
  return worker;
}

const modoTexto = (w) => w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: MODO_AUTO });
const modoDigitos = (w) => w.setParameters({ tessedit_char_whitelist: '0123456789-', tessedit_pageseg_mode: MODO_DISPERSO });

/**
 * @param {HTMLCanvasElement} canvas
 * @param {(fase: 'texto'|'numeros', progreso: number|null) => void} cb
 * @returns {Promise<{texto: string, numeros: string}>}
 */
export async function reconocerDocumento(canvas, cb = () => {}) {
  const w = await obtenerWorker();

  cb('texto', null);
  alProgreso = (p) => cb('texto', p);
  await modoTexto(w);
  const texto = (await w.recognize(canvas)).data.text || '';

  let numeros = '';
  try {
    cb('numeros', null);
    alProgreso = (p) => cb('numeros', p);
    await modoDigitos(w);
    numeros = (await w.recognize(canvas)).data.text || '';
  } catch (e) {
    console.warn('Lectura de dígitos:', e); // si falla, igual se devuelve el texto
  } finally {
    await modoTexto(w);
  }
  return { texto, numeros };
}
