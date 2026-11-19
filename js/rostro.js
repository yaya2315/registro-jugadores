// Busca el rostro en la foto de un DUI o carnet y lo recorta como retrato del jugador.
// Usa MediaPipe (detector BlazeFace) en el propio navegador: la foto no se envía a ningún servidor.
// Si no se puede cargar o no hay rostro, devuelve null y la app deja tomar la foto a mano.

import { recortarRetrato } from './images.js';

const VERSION = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODELO =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

let detector = null;

function obtenerDetector() {
  detector ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import(`${BASE}/vision_bundle.mjs`);
    const archivos = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    return FaceDetector.createFromOptions(archivos, {
      baseOptions: { modelAssetPath: MODELO, delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    });
  })();
  detector.catch(() => { detector = null; }); // permite reintentar si falló la descarga
  return detector;
}

/** Posiciones de ventanas de lado `lado` que cubren `total` con 50 % de solapamiento. */
function posiciones(total, lado) {
  if (lado >= total) return [0];
  const paso = lado / 2;
  const salida = [];
  for (let p = 0; p + lado < total; p += paso) salida.push(p);
  salida.push(total - lado);
  return salida;
}

/**
 * El modelo reduce cada imagen a 128 px, así que un rostro pequeño (como el de un DUI,
 * que ocupa ~15 % de la foto) se le ve mejor si se le pasan recortes cuadrados más chicos.
 * Se prueba la imagen completa y mosaicos a dos escalas.
 */
function zonasDeBusqueda(W, H) {
  const zonas = [{ x: 0, y: 0, w: W, h: H }];
  const lado0 = Math.min(W, H);
  for (const lado of [lado0, lado0 * 0.6]) {
    for (const y of posiciones(H, lado)) {
      for (const x of posiciones(W, lado)) zonas.push({ x, y, w: Math.min(lado, W), h: Math.min(lado, H) });
    }
  }
  return zonas;
}

async function detectarRostros(det, canvas) {
  const W = canvas.width, H = canvas.height;
  const encontrados = [];
  const tmp = document.createElement('canvas');
  for (const z of zonasDeBusqueda(W, H)) {
    tmp.width = Math.round(z.w);
    tmp.height = Math.round(z.h);
    tmp.getContext('2d').drawImage(canvas, z.x, z.y, z.w, z.h, 0, 0, tmp.width, tmp.height);
    const { detections } = det.detect(tmp);
    for (const d of detections) {
      const b = d.boundingBox;
      encontrados.push({
        x: b.originX + z.x, y: b.originY + z.y, w: b.width, h: b.height,
        puntaje: d.categories?.[0]?.score ?? 0.5,
      });
    }
  }
  return encontrados;
}

/** Caja de retrato 3:4 alrededor del rostro (incluye frente, cabello y hombros). */
function cajaRetrato(rostro, W, H) {
  const cx = rostro.x + rostro.w / 2;
  const cy = rostro.y + rostro.h / 2 - rostro.h * 0.04;
  let w = rostro.w * 1.85;
  let h = (w * 4) / 3;
  const ajuste = Math.min(1, W / w, H / h);
  w *= ajuste;
  h *= ajuste;
  const x = Math.min(Math.max(cx - w / 2, 0), W - w);
  const y = Math.min(Math.max(cy - h / 2, 0), H - h);
  return { x, y, w, h };
}

/**
 * @param {HTMLCanvasElement} canvas  foto a color de un documento (o de una persona)
 * @returns {Promise<string|null>} retrato 3:4 como data URL JPEG, o null si no se encontró rostro
 */
export async function extraerRostro(canvas) {
  const det = await obtenerDetector();
  const W = canvas.width, H = canvas.height;
  const validos = (await detectarRostros(det, canvas)).filter((r) => r.w >= W * 0.04 && r.puntaje >= 0.5);
  if (!validos.length) return null;
  // El rostro principal es el más grande: en un DUI también hay una imagen fantasma pequeña.
  // Un mismo rostro sale en varios mosaicos; se queda el de mayor puntaje entre los de tamaño similar.
  validos.sort((a, b) => b.w * b.h * b.puntaje - a.w * a.h * a.puntaje);
  return recortarRetrato(canvas, cajaRetrato(validos[0], W, H));
}
