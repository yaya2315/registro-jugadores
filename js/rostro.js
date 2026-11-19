// Busca el rostro en la foto de un DUI o carnet y deja solo la cabeza del jugador, sin fondo.
//
//   1. BlazeFace (MediaPipe) encuentra la cara.
//   2. Se recorta un retrato 3:4 ajustado a la cabeza (así no entran el texto ni el holograma de la tarjeta).
//   3. Un segmentador de personas quita el fondo; si falla, se usa un óvalo suave alrededor de la cara.
//   4. Retoque mínimo: solo un poco de contraste. La imagen sale con transparencia.
//
// Todo corre en el navegador: la foto no se envía a ningún servidor.
// Si no se puede cargar o no hay rostro, devuelve null y la app deja tomar la foto a mano.

import { RETRATO_W, RETRATO_H } from './images.js';

const VERSION = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODELOS = 'https://storage.googleapis.com/mediapipe-models';
const MODELO_ROSTRO = `${MODELOS}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`;
const MODELO_PERSONA = `${MODELOS}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`;

/* ------------------------------------------------------------------ */
/* Carga perezosa de los modelos                                       */
/* ------------------------------------------------------------------ */

let vision = null;
let detector = null;
let segmentador = null;

function cargarVision() {
  vision ??= (async () => {
    const lib = await import(`${BASE}/vision_bundle.mjs`);
    const archivos = await lib.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    return { lib, archivos };
  })();
  vision.catch(() => { vision = null; }); // permite reintentar si falló la descarga
  return vision;
}

function obtenerDetector() {
  detector ??= (async () => {
    const { lib, archivos } = await cargarVision();
    return lib.FaceDetector.createFromOptions(archivos, {
      baseOptions: { modelAssetPath: MODELO_ROSTRO, delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    });
  })();
  detector.catch(() => { detector = null; });
  return detector;
}

function obtenerSegmentador() {
  segmentador ??= (async () => {
    const { lib, archivos } = await cargarVision();
    return lib.ImageSegmenter.createFromOptions(archivos, {
      baseOptions: { modelAssetPath: MODELO_PERSONA, delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  })();
  segmentador.catch(() => { segmentador = null; });
  return segmentador;
}

/* ------------------------------------------------------------------ */
/* Búsqueda del rostro                                                 */
/* ------------------------------------------------------------------ */

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

function detectarRostros(det, canvas) {
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

/**
 * Caja 3:4 ajustada a la cabeza: frente y cabello arriba, cuello abajo.
 * El cuadro del detector va de las cejas a la barbilla, por eso se amplía ~1.55 veces.
 */
function cajaCabeza(rostro, W, H) {
  const cx = rostro.x + rostro.w / 2;
  const cy = rostro.y + rostro.h * 0.36;
  let w = rostro.w * 1.55;
  let h = (w * 4) / 3;
  const ajuste = Math.min(1, W / w, H / h);
  w *= ajuste;
  h *= ajuste;
  return {
    x: Math.min(Math.max(cx - w / 2, 0), W - w),
    y: Math.min(Math.max(cy - h / 2, 0), H - h),
    w,
    h,
  };
}

/* ------------------------------------------------------------------ */
/* Quitar el fondo                                                     */
/* ------------------------------------------------------------------ */

const suavizar = (m) => {
  const t = Math.min(1, Math.max(0, (m - 0.3) / 0.4));
  return t * t * (3 - 2 * t);
};

/** Aplica una máscara en canvas (su canal alfa) a `base`, con bordes suavizados. */
function aplicarMascaraCanvas(base, mascara, desenfoque) {
  const suave = document.createElement('canvas');
  suave.width = base.width;
  suave.height = base.height;
  const sctx = suave.getContext('2d');
  sctx.filter = `blur(${desenfoque}px)`;
  sctx.drawImage(mascara, 0, 0);
  const ctx = base.getContext('2d');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(suave, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

/** Máscara de persona del segmentador. Devuelve null si el resultado no es creíble. */
async function mascaraPersona(base) {
  const seg = await obtenerSegmentador();
  const res = seg.segment(base);
  try {
    const mc = res.confidenceMasks?.[0];
    if (!mc) return null;
    const datos = mc.getAsFloat32Array();
    const w = mc.width, h = mc.height;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    let cubierto = 0;
    for (let i = 0; i < datos.length; i++) {
      const a = suavizar(datos[i]);
      img.data[i * 4 + 3] = Math.round(a * 255);
      if (a > 0.5) cubierto++;
    }
    ctx.putImageData(img, 0, 0);

    // La cara debe quedar dentro de "persona" y la persona no puede ser casi nada ni casi todo.
    const centro = datos[Math.round(h * 0.45) * w + Math.round(w * 0.5)];
    const fraccion = cubierto / datos.length;
    if (centro < 0.5 || fraccion < 0.2 || fraccion > 0.93) return null;

    if (w === base.width && h === base.height) return canvas;
    const igual = document.createElement('canvas');
    igual.width = base.width;
    igual.height = base.height;
    igual.getContext('2d').drawImage(canvas, 0, 0, igual.width, igual.height);
    return igual;
  } finally {
    res.close?.();
  }
}

/**
 * Óvalo alrededor de la cabeza (cabello arriba, cuello abajo). Se usa siempre:
 * deja fuera los hombros y lo que la tarjeta dibuja encima de ellos (holograma, texto),
 * y si el segmentador no sirve es la única máscara.
 */
function mascaraOvalo(base, rostro, caja) {
  const k = base.width / caja.w;
  const cx = (rostro.x + rostro.w / 2 - caja.x) * k;
  const cy = (rostro.y + rostro.h / 2 - caja.y) * k; // centro del cuadro del detector (cejas a barbilla)
  const rx = rostro.w * k * 0.72;
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.beginPath();
  // Forma de huevo: arriba alta (frente y cabello); abajo se afina hacia el cuello, así quedan fuera
  // los hombros y lo que la tarjeta dibuja encima (holograma, texto).
  const abajo = rostro.h * k * 0.62;
  ctx.ellipse(cx, cy, rx, rostro.h * k * 1.0, 0, Math.PI, 0);
  ctx.bezierCurveTo(cx + rx * 0.95, cy + abajo * 0.55, cx + rx * 0.5, cy + abajo, cx, cy + abajo);
  ctx.bezierCurveTo(cx - rx * 0.5, cy + abajo, cx - rx * 0.95, cy + abajo * 0.55, cx - rx, cy);
  ctx.closePath();
  ctx.fill();
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Resultado                                                           */
/* ------------------------------------------------------------------ */

let soportaWebp = null;
/** WebP con transparencia pesa ~10 veces menos que PNG; Safari no sabe crearlo, ahí se usa PNG. */
function aData(canvas) {
  soportaWebp ??= document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
  return soportaWebp ? canvas.toDataURL('image/webp', 0.85) : canvas.toDataURL('image/png');
}

/**
 * @param {HTMLCanvasElement} canvas  foto a color de un documento (o de una persona)
 * @returns {Promise<string|null>} retrato 3:4 sin fondo (data URL con transparencia), o null si no hay rostro
 */
export async function extraerRostro(canvas) {
  const det = await obtenerDetector();
  const W = canvas.width, H = canvas.height;
  const validos = detectarRostros(det, canvas).filter((r) => r.w >= W * 0.03 && r.puntaje >= 0.6);
  if (!validos.length) return null;
  // Manda la confianza del modelo (un cuadro grande pero dudoso, como el traje o el escudo de la tarjeta,
  // no debe ganarle a una cara segura). Entre los casi igual de seguros, el más grande es el principal:
  // en un DUI también hay una imagen fantasma pequeña.
  const mejor = Math.max(...validos.map((r) => r.puntaje));
  const rostro = validos
    .filter((r) => r.puntaje >= mejor - 0.1)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const caja = cajaCabeza(rostro, W, H);

  // Retrato base con un retoque mínimo (solo un poco de contraste).
  const base = document.createElement('canvas');
  base.width = RETRATO_W;
  base.height = RETRATO_H;
  const ctx = base.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'contrast(1.06) saturate(1.04)';
  ctx.drawImage(canvas, caja.x, caja.y, caja.w, caja.h, 0, 0, RETRATO_W, RETRATO_H);
  ctx.filter = 'none';

  let mascara = null;
  try {
    mascara = await mascaraPersona(base);
  } catch (e) {
    console.warn('Segmentación:', e);
  }
  if (mascara) aplicarMascaraCanvas(base, mascara, 1.2); // quita el fondo
  aplicarMascaraCanvas(base, mascaraOvalo(base, rostro, caja), 5); // deja solo la cabeza

  return aData(base);
}
