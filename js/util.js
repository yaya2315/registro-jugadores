// Utilidades compartidas por la app, la impresión, el respaldo y la administración.

import { normalizar } from './parser.js';

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Crea un elemento: el('div', {class: 'x', text: 'hola', onclick: fn}, hijo1, hijo2). */
export function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...hijos.flat().filter((h) => h != null && h !== false));
  return n;
}

export const DOCS = { dui: 'DUI', carnet: 'Carnet' };
export const LADOS = ['frente', 'reverso'];
export const CLAVES = Object.keys(DOCS).flatMap((d) => LADOS.map((l) => `${d}_${l}`));

export const fechaLegible = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export function edad(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const hoy = new Date();
  let e = hoy.getFullYear() - y;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) e--;
  return e >= 0 && e < 110 ? e : null;
}

export const nombreCompleto = (p) => [p.nombres, p.apellidos].filter(Boolean).join(' ');
export const claveEquipo = (e) => normalizar(String(e || '').trim());

/** Fecha y hora corta: 18/11/2026, 10:05 p. m. */
export const fechaHora = (d) =>
  d ? d.toLocaleString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/**
 * Fotos de documentos de un jugador, con las claves actuales (dui_frente, ...).
 * Los registros del formato anterior guardaban "frente" / "reverso" de un solo documento.
 * @returns {Promise<{fotos: Record<string,string>, deAntiguas: Set<string>}>}
 */
export async function leerFotosDe(api, p) {
  const antiguo = !!p.tipo;
  const crudo = await api.cargarFotos(p.id, { incluirAntiguas: antiguo });
  const fotos = {};
  const deAntiguas = new Set();
  for (const c of CLAVES) if (crudo[c]) fotos[c] = crudo[c];
  if (antiguo) {
    const doc = p.tipo === 'DUI' ? 'dui' : 'carnet';
    for (const l of LADOS) {
      const clave = `${doc}_${l}`;
      if (crudo[l] && !fotos[clave]) {
        fotos[clave] = crudo[l];
        deAntiguas.add(clave);
      }
    }
  }
  return { fotos, deAntiguas };
}
