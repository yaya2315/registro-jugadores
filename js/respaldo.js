// Exportaciones: tabla para Excel (CSV) y respaldo completo en ZIP con todas las fotos.
//
// Estructura del ZIP:
//   LEEME.txt          qué contiene y cómo usarlo
//   jugadores.csv      tabla lista para abrir en Excel
//   respaldo.json      todos los datos (y la lista de usuarios), con las rutas de cada foto
//   fotos/<Apellidos_Nombres_id>/cara.webp, dui_frente.jpg, dui_reverso.jpg, carnet_frente.jpg, ...

import { crearZip } from './zip.js';
import { CLAVES, edad, fechaLegible, fechaHora, leerFotosDe } from './util.js';
import { normalizar } from './parser.js';

const COLUMNAS = ['Nombres', 'Apellidos', 'DUI', 'Carnet', 'Fecha de nacimiento', 'Edad', 'Equipo', 'Posición', 'Camiseta', 'Teléfono', 'Notas', 'Registrado'];

/** CSV con BOM para que Excel respete las tildes. Neutraliza celdas que Excel leería como fórmulas. */
export function construirCsv(jugadores) {
  const celda = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const filas = jugadores.map((p) => [
    p.nombres, p.apellidos, p.dui, p.carnet, fechaLegible(p.fechaNacimiento), edad(p.fechaNacimiento) ?? '',
    p.equipo, p.posicion, p.camiseta, p.telefono, p.notas, fechaHora(p.creadoEn),
  ]);
  return '﻿' + [COLUMNAS, ...filas].map((f) => f.map(celda).join(',')).join('\r\n');
}

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const EXTENSIONES = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png', 'image/svg+xml': 'svg' };

/** "data:image/jpeg;base64,...." -> { bytes, ext } */
export function dataUrlABytes(url) {
  const coma = url.indexOf(',');
  const cabecera = url.slice(5, coma);
  const mime = cabecera.split(';')[0] || 'application/octet-stream';
  const cuerpo = url.slice(coma + 1);
  let bytes;
  if (/;base64/i.test(cabecera)) {
    const bin = atob(cuerpo);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(cuerpo));
  }
  return { bytes, ext: EXTENSIONES[mime] || 'bin' };
}

/** "Pérez Martínez" -> "Perez_Martinez" (apto para nombres de carpeta en cualquier sistema). */
const limpio = (s) =>
  normalizar(s).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().replace(/(^|_)(\w)/g, (_, a, b) => a + b.toUpperCase());

/** Ejecuta `tarea` sobre cada elemento con un máximo de `n` a la vez. */
async function enParalelo(lista, n, tarea) {
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (siguiente < lista.length) {
      const i = siguiente++;
      await tarea(lista[i], i);
    }
  });
  await Promise.all(trabajadores);
}

/**
 * Arma el respaldo completo. Lee las fotos de cada jugador desde la base de datos.
 * @param {object[]} jugadores
 * @param {object} api            backend (necesita cargarFotos)
 * @param {object[]} usuarios     usuarios autorizados (opcional)
 * @param {(hecho: number, total: number) => void} [progreso]
 * @returns {Promise<{blob: Blob, nombre: string, resumen: {jugadores: number, fotos: number, sinFotos: number}}>}
 */
export async function generarRespaldo(jugadores, api, usuarios = [], progreso = () => {}) {
  const ahora = new Date();
  const dia = ahora.toISOString().slice(0, 10);
  const carpetas = new Set();
  const registros = new Array(jugadores.length);
  const archivos = [];
  let fotosTotal = 0;
  let sinFotos = 0;
  let hechos = 0;
  progreso(0, jugadores.length);

  await enParalelo(jugadores, 5, async (p, i) => {
    let carpeta = `${limpio(p.apellidos) || 'SinApellido'}_${limpio(p.nombres) || 'SinNombre'}`;
    if (carpetas.has(carpeta)) carpeta += `_${p.id.slice(0, 6)}`;
    carpetas.add(carpeta);

    const rutas = {};
    const guardar = (nombreBase, dataUrl) => {
      const { bytes, ext } = dataUrlABytes(dataUrl);
      const ruta = `fotos/${carpeta}/${nombreBase}.${ext}`;
      archivos.push({ nombre: ruta, datos: bytes });
      rutas[nombreBase] = ruta;
      fotosTotal++;
    };

    if (p.foto) guardar('cara', p.foto);
    try {
      const { fotos } = await leerFotosDe(api, p);
      for (const clave of CLAVES) if (fotos[clave]) guardar(clave, fotos[clave]);
    } catch (e) {
      console.error('Respaldo: no se pudieron leer las fotos de', p.id, e);
      sinFotos++;
    }

    const { foto, miniatura, ...datos } = p; // las imágenes van como archivos, no dentro del JSON
    registros[i] = {
      ...datos,
      creadoEn: p.creadoEn instanceof Date ? p.creadoEn.toISOString() : null,
      carpeta: `fotos/${carpeta}`,
      archivos: rutas,
    };
    progreso(++hechos, jugadores.length);
  });

  const json = JSON.stringify(
    {
      version: 1,
      generado: ahora.toISOString(),
      totalJugadores: jugadores.length,
      jugadores: registros,
      usuarios: usuarios.map((u) => ({ correo: u.email, nombre: u.nombre ?? '', administrador: !!u.admin })),
    },
    null,
    2,
  );

  const leeme = [
    'RESPALDO DE JUGADORES',
    `Generado: ${fechaHora(ahora)}`,
    `Jugadores: ${jugadores.length}   Fotos: ${fotosTotal}`,
    sinFotos ? `ATENCIÓN: no se pudieron leer las fotos de ${sinFotos} jugador(es).` : '',
    '',
    'Contenido',
    '  jugadores.csv   Tabla para abrir en Excel.',
    '  respaldo.json   Todos los datos de cada jugador y la lista de usuarios autorizados.',
    '                  Cada jugador indica en "archivos" la ruta de sus fotos.',
    '  fotos/          Una carpeta por jugador con su cara (cara.webp o cara.png) y las fotos',
    '                  de sus documentos (dui_frente, dui_reverso, carnet_frente, carnet_reverso).',
    '',
    'Estos archivos contienen datos personales (DUI y fotos). Guárdalos en un lugar seguro',
    'y no los compartas con personas que no deban verlos.',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\r\n');

  const blob = crearZip(
    [
      { nombre: 'LEEME.txt', datos: leeme },
      { nombre: 'jugadores.csv', datos: construirCsv(jugadores) },
      { nombre: 'respaldo.json', datos: json },
      ...archivos.sort((a, b) => a.nombre.localeCompare(b.nombre)),
    ],
    ahora,
  );
  return { blob, nombre: `respaldo-jugadores-${dia}.zip`, resumen: { jugadores: jugadores.length, fotos: fotosTotal, sinFotos } };
}
