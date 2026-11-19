import './instalar.js';
import { CONFIGURADO } from './firebase-config.js';
import { procesarFoto, cargarCanvas, recorteCentrado } from './images.js';
import { reconocerDocumento } from './ocr.js';
import { extraerRostro } from './rostro.js';
import { parsearDocumento, validarDUI, formatearDUI, normalizar } from './parser.js';

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Crea un elemento: el('div', {class: 'x', text: 'hola', onclick: fn}, hijo1, hijo2). */
function el(tag, props = {}, ...hijos) {
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

const SVG_NS = 'http://www.w3.org/2000/svg';
function icono(id) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 64 64');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', `#${id}`);
  s.append(u);
  return s;
}

const DEMO = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('demo');

const DOCS = { dui: 'DUI', carnet: 'Carnet' };
const LADOS = ['frente', 'reverso'];
const CLAVES = Object.keys(DOCS).flatMap((d) => LADOS.map((l) => `${d}_${l}`));

const vistas = {
  cargando: $('#vista-cargando'),
  config: $('#vista-config'),
  login: $('#vista-login'),
  app: $('#vista-app'),
};
const mostrarVista = (nombre) => {
  for (const [k, v] of Object.entries(vistas)) v.hidden = k !== nombre;
};

let toastTimer;
function toast(msg, esError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (esError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4500);
}

function mostrarLoginMsg(msg) {
  const m = $('#login-msg');
  m.textContent = msg || '';
  m.hidden = !msg;
}

const fechaLegible = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

function edad(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const hoy = new Date();
  let e = hoy.getFullYear() - y;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) e--;
  return e >= 0 && e < 110 ? e : null;
}

const nombreCompleto = (p) => [p.nombres, p.apellidos].filter(Boolean).join(' ');
const claveEquipo = (e) => normalizar(String(e || '').trim());

/** Registros guardados con el formato anterior (un documento por registro) se leen como ficha. */
function adaptar(p) {
  const q = { ...p };
  if (!q.dui && !q.carnet && q.numero) {
    if (q.tipo === 'DUI') q.dui = q.numero;
    else q.carnet = q.numero;
  }
  q.foto = q.foto || '';
  return q;
}

function avatar(p, clase) {
  return p.foto
    ? el('div', { class: clase }, el('img', { src: p.foto, alt: '', loading: 'lazy' }))
    : el('div', { class: `${clase} sin-foto` }, icono('i-persona'));
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

if (!CONFIGURADO && !DEMO) {
  mostrarVista('config');
} else {
  iniciar().catch((e) => {
    console.error(e);
    mostrarVista('login');
    mostrarLoginMsg('No se pudo iniciar la aplicación. Revisa tu conexión e inténtalo de nuevo.');
  });
}

async function iniciar() {
  const modulo = DEMO ? await import('./backend-demo.js') : await import('./backend-firebase.js');
  const api = await modulo.crear();

  let usuario = null;
  let cancelarEscucha = null;
  let players = [];
  const filtro = { doc: 'todos', equipo: '', orden: 'recientes' };

  /* ---------- Sesión ---------- */

  $('#btn-login').addEventListener('click', async () => {
    mostrarLoginMsg('');
    try {
      await api.iniciarSesion();
    } catch (e) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      console.error(e);
      mostrarLoginMsg(
        e.code === 'auth/unauthorized-domain'
          ? 'Este dominio no está autorizado en Firebase (Authentication > Configuración > Dominios autorizados).'
          : e.code === 'auth/popup-blocked'
            ? 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo de nuevo.'
            : 'No se pudo iniciar sesión. Inténtalo de nuevo.',
      );
    }
  });
  $('#btn-salir').addEventListener('click', () => api.cerrarSesion());

  api.alCambiarSesion((user, aviso) => {
    cancelarEscucha?.();
    cancelarEscucha = null;
    usuario = user;
    players = [];
    if (!user) {
      mostrarVista('login');
      mostrarLoginMsg(aviso);
      return;
    }
    $('#usuario-email').textContent = user.email;
    mostrarVista('app');
    cancelarEscucha = api.escuchar(
      (lista) => {
        players = lista.map(adaptar);
        pintarLista();
      },
      (e) => {
        console.error(e);
        toast('No se pudieron cargar los jugadores.', true);
      },
    );
  });

  /* ---------- Lista (plantel) ---------- */

  const comparar = {
    recientes: (a, b) => (b.creadoEn?.getTime?.() ?? Infinity) - (a.creadoEn?.getTime?.() ?? Infinity),
    nombre: (a, b) => `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`, 'es'),
    equipo: (a, b) => (a.equipo || '￿').localeCompare(b.equipo || '￿', 'es') || comparar.nombre(a, b),
    edad: (a, b) => (b.fechaNacimiento || '').localeCompare(a.fechaNacimiento || '') || comparar.nombre(a, b),
  };
  // En "edad" los que no tienen fecha van al final.
  const ordenar = (lista) => {
    const f = comparar[filtro.orden];
    if (filtro.orden !== 'edad') return lista.sort(f);
    const con = lista.filter((p) => p.fechaNacimiento).sort(f);
    return [...con, ...lista.filter((p) => !p.fechaNacimiento).sort(comparar.nombre)];
  };

  function equiposActuales() {
    const mapa = new Map();
    for (const p of players) {
      const k = claveEquipo(p.equipo);
      if (k && !mapa.has(k)) mapa.set(k, String(p.equipo).trim());
    }
    return [...mapa].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }

  function pintarStats(equipos) {
    $('#st-total').textContent = players.length;
    $('#st-dui').textContent = players.filter((p) => p.dui).length;
    $('#st-carnet').textContent = players.filter((p) => p.carnet).length;
    $('#st-equipos').textContent = equipos.length;
  }

  function pintarEquipos(equipos) {
    const sel = $('#sel-equipo');
    if (filtro.equipo && !equipos.some(([k]) => k === filtro.equipo)) filtro.equipo = '';
    sel.replaceChildren(
      el('option', { value: '', text: 'Todos los equipos' }),
      ...equipos.map(([k, nombre]) => el('option', { value: k, text: nombre, selected: k === filtro.equipo })),
    );
    sel.value = filtro.equipo;
    $('#lista-equipos').replaceChildren(...equipos.map(([, nombre]) => el('option', { value: nombre })));
  }

  function pintarLista() {
    const equipos = equiposActuales();
    pintarStats(equipos);
    pintarEquipos(equipos);

    const texto = normalizar($('#buscar').value.trim());
    const filtrados = ordenar(
      players.filter((p) => {
        if (filtro.doc === 'dui' && !p.dui) return false;
        if (filtro.doc === 'carnet' && !p.carnet) return false;
        if (filtro.doc === 'incompletos' && p.dui && p.carnet) return false;
        if (filtro.equipo && claveEquipo(p.equipo) !== filtro.equipo) return false;
        if (!texto) return true;
        return normalizar([p.nombres, p.apellidos, p.dui, p.carnet, p.equipo, p.posicion, p.telefono].join(' ')).includes(texto);
      }),
    );

    $('#lista').replaceChildren(...filtrados.map(crearFila));
    $('#resumen').textContent = players.length
      ? `${filtrados.length} de ${players.length} jugador${players.length === 1 ? '' : 'es'}`
      : '';
    const vacio = $('#vacio');
    vacio.hidden = filtrados.length > 0;
    $('#vacio-texto').textContent = players.length
      ? 'Ningún jugador coincide con tu búsqueda.'
      : 'Aún no hay jugadores. Pulsa «Nuevo jugador» y toma la foto de un DUI o carnet.';
  }

  const chipDoc = (nombre, hay) =>
    el('span', { class: `doc-chip ${hay ? 'ok' : 'falta'}`, 'aria-label': hay ? `${nombre} registrado` : `Falta ${nombre}` }, hay ? '✓ ' : '', nombre);

  function crearFila(p) {
    const e = edad(p.fechaNacimiento);
    const meta = [e != null ? `${e} años` : '', p.posicion, p.camiseta ? `N.º ${p.camiseta}` : ''].filter(Boolean).join(' · ');
    return el(
      'li',
      {},
      el(
        'button',
        { type: 'button', class: 'fila', onclick: () => abrirDetalle(p.id) },
        avatar(p, 'fila-foto'),
        el(
          'div',
          { class: 'fila-info' },
          el('div', { class: 'fila-equipo', text: p.equipo || 'Sin equipo' }),
          el('div', { class: 'fila-apellidos', text: p.apellidos || p.nombres || '(sin nombre)' }),
          p.apellidos ? el('div', { class: 'fila-nombres', text: p.nombres }) : null,
          meta ? el('div', { class: 'fila-meta', text: meta }) : null,
        ),
        el('div', { class: 'fila-docs' }, chipDoc('DUI', !!p.dui), chipDoc('Carnet', !!p.carnet)),
      ),
    );
  }

  $('#buscar').addEventListener('input', pintarLista);
  $('#sel-equipo').addEventListener('change', (ev) => { filtro.equipo = ev.target.value; pintarLista(); });
  $('#sel-orden').addEventListener('change', (ev) => { filtro.orden = ev.target.value; pintarLista(); });
  $$('.chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      filtro.doc = chip.dataset.filtro;
      $$('.chip').forEach((c) => c.classList.toggle('activo', c === chip));
      pintarLista();
    }),
  );

  /* ---------- Exportar CSV ---------- */

  $('#btn-csv').addEventListener('click', () => {
    if (!players.length) return toast('No hay jugadores para exportar.');
    const celda = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita inyección de fórmulas en Excel
      return `"${s.replace(/"/g, '""')}"`;
    };
    const cab = ['Nombres', 'Apellidos', 'DUI', 'Carnet', 'Fecha de nacimiento', 'Edad', 'Equipo', 'Posición', 'Camiseta', 'Teléfono', 'Notas', 'Registrado'];
    const filas = ordenar([...players]).map((p) => [
      p.nombres, p.apellidos, p.dui, p.carnet, fechaLegible(p.fechaNacimiento), edad(p.fechaNacimiento) ?? '',
      p.equipo, p.posicion, p.camiseta, p.telefono, p.notas, p.creadoEn ? p.creadoEn.toLocaleString('es-SV') : '',
    ]);
    const csv = '﻿' + [cab, ...filas].map((f) => f.map(celda).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = el('a', { href: url, download: `jugadores-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* ---------- Fotos de documentos (lectura) ---------- */

  /** @returns {Promise<{fotos: Record<string,string>, deAntiguas: Set<string>}>} */
  async function cargarFotosDe(p) {
    const antiguo = !!p.tipo; // formato anterior: fotos "frente" / "reverso" de un solo documento
    let crudo = {};
    try {
      crudo = await api.cargarFotos(p.id, { incluirAntiguas: antiguo });
    } catch (e) {
      console.error(e);
      toast('No se pudieron cargar las fotos.', true);
    }
    const fotos = {};
    const deAntiguas = new Set();
    for (const c of CLAVES) if (crudo[c]) fotos[c] = crudo[c];
    if (antiguo) {
      const doc = p.tipo === 'DUI' ? 'dui' : 'carnet';
      for (const l of LADOS) {
        const clave = `${doc}_${l}`;
        if (crudo[l] && !fotos[clave]) { fotos[clave] = crudo[l]; deAntiguas.add(clave); }
      }
    }
    return { fotos, deAntiguas };
  }

  /* ---------- Ficha del jugador ---------- */

  const dlgDetalle = $('#dlg-detalle');
  const dlgImg = $('#dlg-img');
  let detalleId = null;

  function abrirVisor(src, alt) {
    $('img', dlgImg)?.remove();
    dlgImg.append(el('img', { src, alt }));
    dlgImg.showModal();
  }
  dlgImg.addEventListener('click', (ev) => { if (ev.target === dlgImg) dlgImg.close(); });

  function bloqueDoc(clave, titulo, numero) {
    const hay = !!numero;
    let estado = null;
    if (hay && clave === 'dui') {
      const ok = validarDUI(numero);
      estado = el('span', { class: `sello ${ok ? 'ok' : 'warn'}`, text: ok ? 'Número válido' : 'Revisar número' });
    }
    return el(
      'div',
      { class: `doc-card ${hay ? '' : 'falta'}` },
      el('span', { class: 'doc-card-t', text: titulo }),
      el('strong', { class: 'doc-card-n', text: hay ? numero : 'Sin registrar' }),
      estado,
    );
  }

  function renderFicha(p, fotos) {
    const e = edad(p.fechaNacimiento);
    const chips = [p.posicion, p.camiseta ? `N.º ${p.camiseta}` : '', e != null ? `${e} años` : ''].filter(Boolean);
    const datos = [
      ['Nacimiento', fechaLegible(p.fechaNacimiento)],
      ['Teléfono', p.telefono ? el('a', { href: `tel:${p.telefono.replace(/[^\d+]/g, '')}`, text: p.telefono }) : ''],
      ['Notas', p.notas],
      ['Registrado', p.creadoEn ? p.creadoEn.toLocaleString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''],
    ].filter(([, v]) => v);

    let seccionFotos;
    if (fotos === null) {
      seccionFotos = el('p', { class: 'cargando', text: 'Cargando fotos de los documentos…' });
    } else {
      const items = CLAVES.filter((c) => fotos[c]).map((c) => {
        const [doc, lado] = c.split('_');
        const titulo = `${DOCS[doc]} · ${lado}`;
        return el(
          'figure',
          {},
          el('button', { type: 'button', class: 'miniatura-doc', 'aria-label': `Ampliar ${titulo}`, onclick: () => abrirVisor(fotos[c], titulo) }, el('img', { src: fotos[c], alt: titulo })),
          el('figcaption', { text: titulo }),
        );
      });
      seccionFotos = items.length ? el('div', { class: 'fotos-doc' }, items) : el('p', { class: 'cargando', text: 'Sin fotos de documentos.' });
    }

    $('#det-contenido').replaceChildren(
      el(
        'div',
        { class: 'ficha-cab' },
        avatar(p, 'ficha-foto'),
        el(
          'div',
          { class: 'ficha-id' },
          el('div', { class: 'fila-equipo', text: p.equipo || 'Sin equipo' }),
          el('h3', { class: 'ficha-apellidos', text: p.apellidos || p.nombres || '(sin nombre)' }),
          p.apellidos ? el('div', { class: 'ficha-nombres', text: p.nombres }) : null,
          chips.length ? el('div', { class: 'etiquetas' }, chips.map((c) => el('span', { class: 'etiqueta', text: c }))) : null,
        ),
      ),
      el('div', { class: 'doc-cards' }, bloqueDoc('dui', 'DUI', p.dui), bloqueDoc('carnet', 'Carnet de fútbol', p.carnet)),
      datos.length
        ? el('dl', { class: 'datos' }, datos.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', {}, v))))
        : null,
      el('h4', { class: 'sub-titulo', text: 'Fotos de los documentos' }),
      seccionFotos,
    );
  }

  async function abrirDetalle(id) {
    const p = players.find((x) => x.id === id);
    if (!p) return;
    detalleId = id;
    renderFicha(p, null);
    dlgDetalle.showModal();
    const { fotos } = await cargarFotosDe(p);
    if (detalleId === id) renderFicha(p, fotos);
  }

  $('#det-editar').addEventListener('click', async () => {
    const p = players.find((x) => x.id === detalleId);
    if (!p) return;
    dlgDetalle.close();
    await abrirFormulario(p);
  });

  $('#det-eliminar').addEventListener('click', async () => {
    const p = players.find((x) => x.id === detalleId);
    if (!p) return;
    if (!confirm(`¿Eliminar a ${nombreCompleto(p) || 'este jugador'}?\nSe borrarán también sus fotos y no se puede deshacer.`)) return;
    try {
      await api.eliminar(p.id);
      dlgDetalle.close();
      toast('Jugador eliminado.');
    } catch (e) {
      console.error(e);
      toast('No se pudo eliminar.', true);
    }
  });
  dlgDetalle.addEventListener('close', () => { detalleId = null; });

  /* ---------- Formulario ---------- */

  const dlgForm = $('#dlg-form');
  const form = $('#form');
  const campos = {
    dui: $('#f-dui'),
    carnet: $('#f-carnet'),
    nombres: $('#f-nombres'),
    apellidos: $('#f-apellidos'),
    fechaNacimiento: $('#f-nacimiento'),
    equipo: $('#f-equipo'),
    posicion: $('#f-posicion'),
    camiseta: $('#f-camiseta'),
    telefono: $('#f-telefono'),
    notas: $('#f-notas'),
  };

  // Lo que la persona escribió a mano nunca se pisa con lo que lee el OCR.
  const tocados = new Set();
  // Qué documento llenó cada campo compartido (para poder mejorarlo con otra foto del mismo documento).
  const origen = {};
  for (const [nombre, campo] of Object.entries(campos)) {
    campo.addEventListener('input', () => { tocados.add(nombre); delete origen[nombre]; actualizarMarcas(); });
  }

  let editando = null;
  let fotosDoc = {}; // clave -> {dataUrl, cambiada}
  let textos = {}; // clave -> {texto, numeros}
  let retrato = null; // {dataUrl, cambiada, manual, origen?}
  let colaOcr = Promise.resolve();
  let guardando = false;

  const docActual = () => form.elements.doc.value;

  function mostrarSeccion() {
    for (const d of Object.keys(DOCS)) $(`#sec-${d}`).hidden = d !== docActual();
  }
  $$('input[name="doc"]').forEach((r) => r.addEventListener('change', mostrarSeccion));

  function actualizarMarcas() {
    for (const d of Object.keys(DOCS)) {
      const completo = campos[d].value.trim() || LADOS.some((l) => fotosDoc[`${d}_${l}`]);
      $(`#seg-${d}`).classList.toggle('completo', !!completo);
    }
  }

  function validarDuiUI() {
    const ayuda = $('#dui-ayuda');
    const v = campos.dui.value.trim();
    ayuda.className = 'campo-ayuda';
    ayuda.textContent = '';
    if (!v) return;
    const ok = validarDUI(v);
    ayuda.textContent = ok ? 'Dígito verificador correcto' : 'El dígito verificador no coincide: revisa el número contra la foto.';
    ayuda.classList.add(ok ? 'ok' : 'warn');
  }
  campos.dui.addEventListener('input', validarDuiUI);
  campos.dui.addEventListener('blur', () => {
    const f = formatearDUI(campos.dui.value);
    if (f !== campos.dui.value) campos.dui.value = f;
    validarDuiUI();
  });

  /* --- Fotos de documentos --- */

  function crearSlot(doc, lado) {
    const clave = `${doc}_${lado}`;
    const inCam = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    const inGal = el('input', { type: 'file', accept: 'image/*', hidden: true });
    const quitar = el('button', { type: 'button', class: 'btn texto peq peligro', hidden: true, text: 'Quitar' });
    for (const inp of [inCam, inGal]) {
      inp.addEventListener('change', async () => {
        const archivo = inp.files[0];
        inp.value = '';
        if (archivo) await alElegirFoto(clave, archivo);
      });
    }
    quitar.addEventListener('click', () => {
      delete fotosDoc[clave];
      delete textos[clave];
      pintarSlot(clave);
      actualizarMarcas();
    });
    return el(
      'div',
      { class: 'foto', 'data-clave': clave },
      el('div', { class: 'foto-marco' }, el('span', { class: 'foto-vacio', text: lado === 'frente' ? 'Frente' : 'Reverso' })),
      el('div', { class: 'foto-acciones' }, el('label', { class: 'btn secundario peq' }, 'Tomar foto', inCam), el('label', { class: 'btn texto peq' }, 'Galería', inGal), quitar),
    );
  }

  for (const doc of Object.keys(DOCS)) $(`#sec-${doc} .fotos`).append(...LADOS.map((l) => crearSlot(doc, l)));

  function pintarSlot(clave) {
    const cont = $(`.foto[data-clave="${clave}"]`);
    const marco = $('.foto-marco', cont);
    const f = fotosDoc[clave];
    $('img', marco)?.remove();
    marco.classList.toggle('con-foto', !!f);
    $('.foto-vacio', marco).hidden = !!f;
    if (f) marco.prepend(el('img', { src: f.dataUrl, alt: `Foto ${clave.replace('_', ' ')}` }));
    $('[class*="peligro"]', cont).hidden = !f;
  }

  /* --- Estado de lectura --- */

  function estadoOcr(visible, texto = '', progreso = null) {
    const caja = $('#ocr-estado');
    caja.hidden = !visible;
    caja.classList.toggle('indeterminado', visible && progreso === null);
    $('#ocr-progreso').style.width = progreso === null ? '' : `${Math.round(progreso * 100)}%`;
    $('#ocr-texto').textContent = texto;
  }

  async function alElegirFoto(clave, archivo) {
    if (!archivo.type.startsWith('image/')) return toast('Elige un archivo de imagen.', true);
    let proc;
    try {
      proc = await procesarFoto(archivo);
    } catch (e) {
      console.error(e);
      return toast('No se pudo leer esa imagen.', true);
    }
    fotosDoc[clave] = { dataUrl: proc.dataUrl, cambiada: true };
    delete textos[clave];
    pintarSlot(clave);
    actualizarMarcas();
    // Se procesan de una en una para no saturar el teléfono.
    colaOcr = colaOcr.then(() => procesar(clave, proc));
  }

  const debeBuscarRostro = (clave) =>
    !retrato?.manual && (!retrato || (retrato.origen?.endsWith('reverso') && clave.endsWith('frente')));

  async function procesar(clave, proc) {
    const [doc, lado] = clave.split('_');
    const nombre = `${DOCS[doc]} (${lado})`;
    let leyoDatos = false;
    let leyoRostro = false;
    let ocrOk = false;

    try {
      estadoOcr(true, 'Preparando el lector de texto… la primera vez tarda un poco.');
      const r = await reconocerDocumento(proc.ocrCanvas, (fase, p) => {
        const txt = fase === 'texto' ? `Leyendo ${nombre}` : `Buscando el número en ${nombre}`;
        estadoOcr(true, p == null ? `${txt}…` : `${txt}… ${Math.round(p * 100)}%`, p);
      });
      ocrOk = true;
      if (fotosDoc[clave]) {
        textos[clave] = r;
        leyoDatos = aplicarOcr(doc);
      }
    } catch (e) {
      console.error(e);
      toast(e.message || 'No se pudo leer el texto de la foto.', true);
    }

    if (fotosDoc[clave] && debeBuscarRostro(clave)) {
      try {
        estadoOcr(true, 'Buscando la foto del jugador…');
        const url = await extraerRostro(proc.colorCanvas);
        if (url && fotosDoc[clave] && debeBuscarRostro(clave)) {
          retrato = { dataUrl: url, cambiada: true, manual: false, origen: clave };
          pintarRetrato();
          leyoRostro = true;
        }
      } catch (e) {
        console.warn('Rostro:', e);
      }
    }
    estadoOcr(false);
    if (!fotosDoc[clave]) return;

    const partes = [leyoDatos ? 'datos' : '', leyoRostro ? 'foto del jugador' : ''].filter(Boolean);
    let msg = partes.length ? `Leído: ${partes.join(' y ')}. Revísalo antes de guardar.` : 'No se pudo leer nada claro; escribe los datos a mano.';
    if (ocrOk && !campos[doc].value.trim()) msg += ` Falta el número de ${DOCS[doc]}: escríbelo a mano.`;
    toast(msg, !partes.length);
  }

  /** Rellena el formulario con lo leído. Devuelve true si cambió algo. */
  function aplicarOcr(doc) {
    const claves = LADOS.map((l) => `${doc}_${l}`).filter((c) => textos[c]);
    if (!claves.length) return false;
    const r = parsearDocumento(
      doc === 'dui' ? 'DUI' : 'CARNET',
      claves.map((c) => textos[c].texto).join('\n'),
      claves.map((c) => textos[c].numeros).join('\n'),
    );
    let cambio = false;
    const poner = (campo, valor, compartido) => {
      if (!valor || tocados.has(campo)) return;
      const actual = campos[campo].value;
      if (compartido && actual && origen[campo] !== doc) return; // lo llenó otro documento: se respeta
      if (actual !== valor) { campos[campo].value = valor; cambio = true; }
      origen[campo] = doc;
    };
    poner(doc, r.numero, false);
    poner('nombres', r.nombres, true);
    poner('apellidos', r.apellidos, true);
    poner('fechaNacimiento', r.fechaNacimiento, true);
    poner('equipo', r.equipo, true);
    validarDuiUI();
    actualizarMarcas();
    return cambio;
  }

  /* --- Retrato del jugador --- */

  function pintarRetrato() {
    const marco = $('#retrato-marco');
    $('img', marco)?.remove();
    marco.classList.toggle('con-foto', !!retrato);
    $('.retrato-vacio', marco).hidden = !!retrato;
    if (retrato) marco.prepend(el('img', { src: retrato.dataUrl, alt: 'Foto del jugador' }));
    $('#ret-quitar').hidden = !retrato;
  }

  async function alElegirRetrato(archivo) {
    if (!archivo.type.startsWith('image/')) return toast('Elige un archivo de imagen.', true);
    try {
      estadoOcr(true, 'Preparando la foto del jugador…');
      const canvas = await cargarCanvas(archivo);
      let url = null;
      try { url = await extraerRostro(canvas); } catch (e) { console.warn('Rostro:', e); }
      retrato = { dataUrl: url || recorteCentrado(canvas), cambiada: true, manual: true };
      pintarRetrato();
    } catch (e) {
      console.error(e);
      toast('No se pudo leer esa imagen.', true);
    } finally {
      estadoOcr(false);
    }
  }
  for (const id of ['#ret-cam', '#ret-gal']) {
    $(id).addEventListener('change', async (ev) => {
      const archivo = ev.target.files[0];
      ev.target.value = '';
      if (archivo) await alElegirRetrato(archivo);
    });
  }
  $('#ret-quitar').addEventListener('click', () => {
    retrato = null;
    pintarRetrato();
  });

  /* --- Abrir / guardar --- */

  async function abrirFormulario(registro = null) {
    editando = registro;
    fotosDoc = {};
    textos = {};
    retrato = null;
    tocados.clear();
    for (const k of Object.keys(origen)) delete origen[k];
    form.reset();
    errorForm('');
    estadoOcr(false);
    $('#form-titulo').textContent = registro ? 'Editar jugador' : 'Nuevo jugador';
    $('#btn-guardar').textContent = registro ? 'Guardar cambios' : 'Guardar';

    if (registro) {
      for (const [k, campo] of Object.entries(campos)) {
        campo.value = registro[k] ?? '';
        if (campo.value) tocados.add(k);
      }
      if (registro.foto) retrato = { dataUrl: registro.foto, cambiada: false, manual: true };
    }
    form.elements.doc.value = registro && !registro.dui && registro.carnet ? 'carnet' : 'dui';
    mostrarSeccion();
    CLAVES.forEach(pintarSlot);
    pintarRetrato();
    validarDuiUI();
    actualizarMarcas();
    dlgForm.showModal();

    if (registro) {
      const { fotos, deAntiguas } = await cargarFotosDe(registro);
      if (editando?.id !== registro.id) return;
      for (const c of CLAVES) {
        if (fotos[c] && !fotosDoc[c]) {
          // Las del formato anterior se vuelven a guardar con las claves nuevas.
          fotosDoc[c] = { dataUrl: fotos[c], cambiada: deAntiguas.has(c) };
          pintarSlot(c);
        }
      }
      actualizarMarcas();
    }
  }

  $('#btn-nuevo').addEventListener('click', () => abrirFormulario());

  function errorForm(msg) {
    const e = $('#form-error');
    e.textContent = msg;
    e.hidden = !msg;
    if (msg) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (guardando) return;
    errorForm('');

    const datos = {
      nombres: campos.nombres.value.trim(),
      apellidos: campos.apellidos.value.trim(),
      fechaNacimiento: campos.fechaNacimiento.value,
      equipo: campos.equipo.value.trim(),
      posicion: campos.posicion.value,
      camiseta: campos.camiseta.value.replace(/\D/g, ''),
      telefono: campos.telefono.value.trim(),
      notas: campos.notas.value.trim(),
      dui: formatearDUI(campos.dui.value.trim()),
      carnet: campos.carnet.value.trim(),
      foto: retrato ? retrato.dataUrl : '',
    };

    if (!datos.nombres) return errorForm('Escribe los nombres del jugador.');
    if (!datos.dui && !datos.carnet) return errorForm('Escribe el número del DUI o del carnet.');
    if (!Object.keys(fotosDoc).length) return errorForm('Agrega al menos una foto del DUI o del carnet.');

    const repetido = players.find(
      (p) =>
        p.id !== editando?.id &&
        ((datos.dui && p.dui && normalizar(p.dui) === normalizar(datos.dui)) ||
          (datos.carnet && p.carnet && normalizar(p.carnet) === normalizar(datos.carnet))),
    );
    if (repetido && !confirm(`Ya existe un jugador con ese número (${nombreCompleto(repetido)}). ¿Guardar de todas formas?`)) return;

    const fotos = {};
    for (const clave of CLAVES) {
      const f = fotosDoc[clave];
      if (f?.cambiada) fotos[clave] = f.dataUrl;
      else if (!f && editando) fotos[clave] = null; // la quitaron
    }

    guardando = true;
    const btn = $('#btn-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await api.guardar({ id: editando?.id, datos, fotos, usuario: usuario.email, borrarAntiguas: !!editando?.tipo });
      dlgForm.close();
      toast(editando ? 'Cambios guardados.' : 'Jugador guardado.');
    } catch (e) {
      console.error(e);
      errorForm(
        e.code === 'permission-denied'
          ? 'No tienes permiso para guardar. Vuelve a iniciar sesión.'
          : 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.',
      );
    } finally {
      guardando = false;
      btn.disabled = false;
      btn.textContent = editando ? 'Guardar cambios' : 'Guardar';
    }
  });

  /* ---------- Cerrar diálogos ---------- */
  $$('[data-cerrar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
}
