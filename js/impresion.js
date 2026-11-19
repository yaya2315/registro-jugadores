// Hojas para imprimir o guardar como PDF: planilla de un equipo y ficha de un jugador.
// Se arman dentro de #hoja-impresion (oculta en pantalla). Al imprimir, el CSS esconde todo lo demás.
// En el diálogo de impresión se elige "Guardar como PDF" para obtener el archivo.

import { el, CLAVES, DOCS, edad, fechaLegible, fechaHora, nombreCompleto } from './util.js';

const comparar = (a, b) => `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`, 'es');

function cabecera(titulo, subtitulo) {
  return el(
    'header',
    { class: 'hi-cab' },
    el('div', {}, el('h1', { text: titulo }), subtitulo ? el('p', { text: subtitulo }) : null),
    el('p', { class: 'hi-fecha', text: `Impreso el ${fechaHora(new Date())}` }),
  );
}

const celdaFoto = (p) =>
  el('td', { class: 'hi-foto' }, p.foto ? el('img', { src: p.foto, alt: '' }) : el('span', { class: 'hi-sin-foto' }));

/**
 * @param {object[]} jugadores
 * @param {{equipo?: string, fotos?: boolean, firma?: boolean, telefono?: boolean}} opciones
 *   equipo: nombre del equipo (vacío = todos, y se agrega la columna Equipo)
 */
export function construirPlanilla(jugadores, { equipo = '', fotos = true, firma = true, telefono = false } = {}) {
  const lista = [...jugadores].sort((a, b) => (equipo ? 0 : (a.equipo || '￿').localeCompare(b.equipo || '￿', 'es')) || comparar(a, b));

  const columnas = [
    ['N.º', 'hi-n'],
    fotos ? ['Foto', 'hi-foto'] : null,
    ['Jugador', 'hi-jugador'],
    equipo ? null : ['Equipo', 'hi-equipo'],
    ['DUI', 'hi-doc'],
    ['Carnet', 'hi-doc'],
    ['Nacimiento', 'hi-nac'],
    ['Pos.', 'hi-pos'],
    ['Cam.', 'hi-cam'],
    telefono ? ['Teléfono', 'hi-tel'] : null,
    firma ? ['Firma', 'hi-firma'] : null,
  ].filter(Boolean);

  const filas = lista.map((p, i) => {
    const e = edad(p.fechaNacimiento);
    const celdas = {
      'hi-n': el('td', { class: 'hi-n', text: String(i + 1) }),
      'hi-foto': fotos ? celdaFoto(p) : null,
      'hi-jugador': el('td', { class: 'hi-jugador' }, el('strong', { text: (p.apellidos || p.nombres || '').toUpperCase() }), p.apellidos ? el('div', { text: p.nombres }) : null),
      'hi-equipo': el('td', { class: 'hi-equipo', text: p.equipo || '' }),
      'hi-nac': el('td', { class: 'hi-nac' }, fechaLegible(p.fechaNacimiento), e != null ? el('div', { class: 'hi-suave', text: `${e} años` }) : null),
      'hi-pos': el('td', { class: 'hi-pos', text: p.posicion || '' }),
      'hi-cam': el('td', { class: 'hi-cam', text: p.camiseta || '' }),
      'hi-tel': el('td', { class: 'hi-tel', text: p.telefono || '' }),
      'hi-firma': el('td', { class: 'hi-firma' }),
    };
    const duis = [el('td', { class: 'hi-doc', text: p.dui || '' }), el('td', { class: 'hi-doc', text: p.carnet || '' })];
    let doc = 0;
    return el('tr', {}, columnas.map(([, clase]) => (clase === 'hi-doc' ? duis[doc++] : celdas[clase])));
  });

  return el(
    'div',
    { class: 'hi-planilla' },
    cabecera('Planilla de jugadores', `${equipo || 'Todos los equipos'} · ${lista.length} jugador${lista.length === 1 ? '' : 'es'}`),
    el(
      'table',
      { class: 'hi-tabla' },
      el('thead', {}, el('tr', {}, columnas.map(([titulo, clase]) => el('th', { class: clase, text: titulo })))),
      el('tbody', {}, filas.length ? filas : el('tr', {}, el('td', { colspan: String(columnas.length), class: 'hi-vacio', text: 'No hay jugadores para mostrar.' }))),
    ),
    el('footer', { class: 'hi-pie', text: `Total: ${lista.length} jugador${lista.length === 1 ? '' : 'es'}` }),
  );
}

/**
 * @param {object} p       jugador
 * @param {Record<string,string>} fotos  fotos de documentos (claves dui_frente, ...)
 */
export function construirFicha(p, fotos = {}) {
  const e = edad(p.fechaNacimiento);
  const datos = [
    ['DUI', p.dui],
    ['Carnet de fútbol', p.carnet],
    ['Fecha de nacimiento', p.fechaNacimiento ? `${fechaLegible(p.fechaNacimiento)}${e != null ? ` (${e} años)` : ''}` : ''],
    ['Equipo', p.equipo],
    ['Posición', p.posicion],
    ['N.º de camiseta', p.camiseta],
    ['Teléfono', p.telefono],
    ['Notas', p.notas],
    ['Registrado', fechaHora(p.creadoEn)],
  ].filter(([, v]) => v);

  const imagenes = CLAVES.filter((c) => fotos[c]).map((c) => {
    const [doc, lado] = c.split('_');
    return el('figure', {}, el('img', { src: fotos[c], alt: '' }), el('figcaption', { text: `${DOCS[doc]} · ${lado}` }));
  });

  return el(
    'div',
    { class: 'hi-ficha' },
    cabecera('Ficha del jugador', p.equipo || ''),
    el(
      'section',
      { class: 'hi-ficha-cab' },
      p.foto ? el('img', { class: 'hi-retrato', src: p.foto, alt: '' }) : el('div', { class: 'hi-retrato hi-sin-foto' }),
      el('div', {}, el('h2', { text: (p.apellidos || p.nombres || '(sin nombre)').toUpperCase() }), p.apellidos ? el('p', { class: 'hi-nombres', text: p.nombres }) : null),
    ),
    el('dl', { class: 'hi-datos' }, datos.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v })))),
    imagenes.length ? el('section', { class: 'hi-docs' }, el('h3', { text: 'Fotos de los documentos' }), el('div', { class: 'hi-docs-grid' }, imagenes)) : null,
    el('footer', { class: 'hi-pie', text: nombreCompleto(p) }),
  );
}

/** Pone el contenido en la hoja de impresión, espera a que carguen las imágenes y abre el diálogo de imprimir. */
export async function imprimir(contenido) {
  const hoja = document.getElementById('hoja-impresion');
  hoja.replaceChildren(contenido);
  await Promise.all([...hoja.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
  window.addEventListener('afterprint', () => hoja.replaceChildren(), { once: true });
  window.print();
}
