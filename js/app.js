import './instalar.js';
import { CONFIGURADO } from './firebase-config.js';
import { procesarFoto, cargarCanvas, recorteCentrado } from './images.js';
import { reconocerDocumento } from './ocr.js';
import { extraerRostro } from './rostro.js';
import { parsearDocumento, validarDUI, formatearDUI, normalizar, claveDocumento } from './parser.js';
import { $, $$, el, DOCS, LADOS, CLAVES, fechaLegible, edad, nombreCompleto, claveEquipo, fechaHora, leerFotosDe } from './util.js';
import { construirCsv, descargar } from './respaldo.js';
import { construirPlanilla, construirFicha, imprimir } from './impresion.js';
import { iniciarAdmin } from './admin.js';

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

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
    $('#btn-admin').hidden = !user.admin; // solo los administradores ven "Administrar"
    mostrarVista('app');
    cancelarEscucha = api.escuchar(
      (lista) => {
        players = lista.map(adaptar);
        pintarLista();
        if (dlgForm.open) evaluarRepetido(); // otro teléfono pudo registrar ese DUI/carnet mientras se llenaba el formulario
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

  /** Cuántos filtros distintos del valor por defecto hay puestos (se ve en el botón aunque el panel esté plegado). */
  function actualizarContadorFiltros() {
    const activos = (filtro.doc !== 'todos') + Boolean(filtro.equipo) + (filtro.orden !== 'recientes');
    const marca = $('#filtros-activos');
    marca.textContent = activos;
    marca.hidden = activos === 0;
    $('#btn-filtros').classList.toggle('con-filtros', activos > 0);
    $('#btn-filtros').setAttribute('aria-label', activos ? `Filtros, ${activos} activo${activos === 1 ? '' : 's'}` : 'Filtros');
  }

  function pintarLista() {
    actualizarContadorFiltros();
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

  $('#btn-filtros').addEventListener('click', () => {
    const panel = $('#panel-filtros');
    panel.hidden = !panel.hidden;
    $('#btn-filtros').setAttribute('aria-expanded', String(!panel.hidden));
  });

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

  /* ---------- Exportar a Excel ---------- */

  $('#btn-csv').addEventListener('click', () => {
    if (!players.length) return toast('No hay jugadores para exportar.');
    const csv = construirCsv(ordenar([...players]));
    descargar(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `jugadores-${new Date().toISOString().slice(0, 10)}.csv`);
  });

  /* ---------- Fotos de documentos (lectura) ---------- */

  /** @returns {Promise<{fotos: Record<string,string>, deAntiguas: Set<string>}>} */
  async function cargarFotosDe(p) {
    try {
      return await leerFotosDe(api, p);
    } catch (e) {
      console.error(e);
      toast('No se pudieron cargar las fotos.', true);
      return { fotos: {}, deAntiguas: new Set() };
    }
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

  $('#det-imprimir').addEventListener('click', async () => {
    const p = players.find((x) => x.id === detalleId);
    if (!p) return;
    const { fotos } = await cargarFotosDe(p);
    await imprimir(construirFicha(p, fotos));
  });

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
    campo.addEventListener('input', () => {
      tocados.add(nombre);
      delete origen[nombre];
      actualizarMarcas();
      if (nombre === 'dui' || nombre === 'carnet') evaluarRepetido();
    });
  }

  let editando = null;
  let fotosDoc = {}; // clave -> {dataUrl, cambiada}
  let textos = {}; // clave -> {texto, numeros}
  let retrato = null; // {dataUrl, cambiada, manual, origen?}
  let colaOcr = Promise.resolve();
  let guardando = false;
  let existente = null; // jugador ya registrado con el mismo DUI/carnet: al guardar se actualiza, no se crea otro
  let conflicto = ''; // motivo por el que no se puede guardar (número de otro jugador, o DUI y carnet de dos distintos)

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

  /* --- Jugador ya registrado: se avisa y se actualiza, nunca se duplica --- */

  function aplicarTextosForm() {
    $('#form-titulo').textContent = editando ? 'Editar jugador' : existente ? 'Actualizar jugador' : 'Nuevo jugador';
    $('#btn-guardar').textContent = editando ? 'Guardar cambios' : existente ? 'Actualizar ficha' : 'Guardar';
  }

  /** Jugadores (distintos del que se edita) que ya tienen el DUI o el carnet que hay en el formulario. */
  function buscarRepetidos() {
    const kd = claveDocumento('dui', campos.dui.value);
    const kc = claveDocumento('carnet', campos.carnet.value);
    const otros = players.filter((p) => p.id !== editando?.id);
    return {
      porDui: kd ? otros.find((p) => claveDocumento('dui', p.dui) === kd) : null,
      porCarnet: kc ? otros.find((p) => claveDocumento('carnet', p.carnet) === kc) : null,
    };
  }

  let avisoVisto = '';
  function evaluarRepetido() {
    const aviso = $('#aviso-repetido');
    const { porDui, porCarnet } = buscarRepetidos();
    existente = null;
    conflicto = '';

    if (porDui && porCarnet && porDui.id !== porCarnet.id) {
      // Dos jugadores distintos: no hay a cuál actualizar, así que no se deja guardar.
      conflicto = `El DUI es de ${nombreCompleto(porDui)} y el carnet es de ${nombreCompleto(porCarnet)}. Son jugadores distintos: revisa los números.`;
    } else if (porDui || porCarnet) {
      const p = porDui || porCarnet;
      if (editando) conflicto = `Ese ${porDui ? 'DUI' : 'carnet'} ya pertenece a ${nombreCompleto(p)}. No se puede repetir.`;
      else existente = p;
    }

    if (conflicto) {
      aviso.className = 'repetido error';
      aviso.replaceChildren(
        el('div', { class: 'repetido-icono', 'aria-hidden': 'true', text: '!' }),
        el('div', { class: 'repetido-texto' }, el('strong', { text: 'No se puede repetir' }), el('p', { text: conflicto })),
      );
    } else if (existente) {
      const p = existente;
      const docs = [p.dui ? 'DUI' : '', p.carnet ? 'carnet' : ''].filter(Boolean).join(' y ');
      aviso.className = 'repetido';
      aviso.replaceChildren(
        avatar(p, 'fila-foto'),
        el(
          'div',
          { class: 'repetido-texto' },
          el('strong', { text: 'Este jugador ya está registrado' }),
          el('p', { class: 'repetido-quien', text: `${nombreCompleto(p)}${p.equipo ? ` · ${p.equipo}` : ''}` }),
          el('p', { text: `Documentos guardados: ${docs || 'ninguno'}.` }),
          el('p', { text: 'Si guardas, se actualiza su ficha con lo que escribiste o leíste. Lo que dejes en blanco se conserva. No se crea otro jugador.' }),
        ),
      );
    }
    aviso.hidden = !conflicto && !existente;
    aplicarTextosForm();

    // Si el aviso aparece o cambia, se lleva a la vista (el formulario puede estar desplazado hacia abajo).
    const marca = conflicto || existente?.id || '';
    if (marca && marca !== avisoVisto) aviso.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    avisoVisto = marca;
  }

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
    // Quitaron la foto o ya cerraron el formulario (p. ej. guardaron antes de que terminara la lectura): no se avisa nada.
    if (!fotosDoc[clave] || !dlgForm.open) return;

    const partes = [leyoDatos ? 'datos' : '', leyoRostro ? 'foto del jugador' : ''].filter(Boolean);
    let msg = partes.length ? `Leído: ${partes.join(' y ')}. Revísalo antes de guardar.` : 'No se pudo leer nada claro; escribe los datos a mano.';
    if (ocrOk && !campos[doc].value.trim()) msg += ` Falta el número de ${DOCS[doc]}: escríbelo a mano.`;
    if (conflicto) msg = conflicto;
    else if (existente) msg = `Este jugador ya está registrado (${nombreCompleto(existente)}). Si guardas, se actualiza su ficha; no se crea otro.`;
    toast(msg, Boolean(conflicto) || (!partes.length && !existente));
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
    evaluarRepetido(); // ¿ya existe un jugador con el DUI o carnet que se acaba de leer?
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

  /** Vuelve a sacar la cara (sin fondo) de las fotos de documento que ya están en el formulario. */
  $('#ret-doc').addEventListener('click', async () => {
    const clave = ['dui_frente', 'carnet_frente', 'dui_reverso', 'carnet_reverso'].find((c) => fotosDoc[c]);
    if (!clave) return toast('Primero agrega la foto del DUI o del carnet.', true);
    try {
      estadoOcr(true, 'Buscando la foto del jugador…');
      const img = new Image();
      img.src = fotosDoc[clave].dataUrl;
      await img.decode();
      const canvas = el('canvas', { width: img.naturalWidth, height: img.naturalHeight });
      canvas.getContext('2d').drawImage(img, 0, 0);
      const url = await extraerRostro(canvas);
      if (!url) return toast('No se encontró un rostro en esa foto. Toma o sube la foto del jugador.', true);
      retrato = { dataUrl: url, cambiada: true, manual: false, origen: clave };
      pintarRetrato();
      toast('Foto del jugador actualizada.');
    } catch (e) {
      console.error(e);
      toast('No se pudo sacar la foto del documento.', true);
    } finally {
      estadoOcr(false);
    }
  });

  /* --- Abrir / guardar --- */

  async function abrirFormulario(registro = null) {
    editando = registro;
    existente = null;
    conflicto = '';
    avisoVisto = '';
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
    evaluarRepetido();
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

    // Nunca se crea un jugador repetido: si el DUI o carnet ya existe, se actualiza esa ficha.
    evaluarRepetido();
    if (conflicto) return errorForm(conflicto);
    if (existente) {
      // Lo nuevo reemplaza a lo anterior (por si estaba mal); lo que se deja en blanco se conserva.
      for (const k of Object.keys(datos)) if (datos[k] === '') datos[k] = existente[k] ?? '';
    }

    if (!datos.nombres) return errorForm('Escribe los nombres del jugador.');
    if (!datos.dui && !datos.carnet) return errorForm('Escribe el número del DUI o del carnet.');
    if (!existente && !Object.keys(fotosDoc).length) return errorForm('Agrega al menos una foto del DUI o del carnet.');

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
      const actualizando = !!existente;
      const resultado = await api.guardar({ id: editando?.id ?? existente?.id, datos, fotos, usuario: usuario.email, borrarAntiguas: !!editando?.tipo });
      dlgForm.close();
      toast(actualizando ? 'Ficha actualizada. No se creó otro jugador.' : editando ? 'Cambios guardados.' : 'Jugador guardado.');
      if (resultado?.sinLlaves && usuario.admin) {
        // Solo a los administradores: son quienes pueden publicar las reglas en Firebase.
        toast('Guardado. Falta publicar las reglas nuevas de Firebase (firestore.rules) para que no se repitan DUI o carnets entre teléfonos.', true);
      }
    } catch (e) {
      console.error(e);
      if (e.code === 'repetido') {
        // Otra persona acaba de registrar ese DUI o carnet y esta pantalla todavía no lo sabía.
        const otro = players.find((p) => p.id === e.jugadorId);
        errorForm(`Ese ${e.tipo === 'dui' ? 'DUI' : 'carnet'} ya está registrado${otro ? ` (${nombreCompleto(otro)})` : ''}. Revisa el aviso de arriba y vuelve a intentar.`);
        evaluarRepetido();
      } else {
        errorForm(
          e.code === 'permission-denied'
            ? 'No tienes permiso para guardar. Vuelve a iniciar sesión.'
            : 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.',
        );
      }
    } finally {
      guardando = false;
      btn.disabled = false;
      aplicarTextosForm();
    }
  });

  /* ---------- Imprimir planilla ---------- */

  const dlgPlanilla = $('#dlg-planilla');

  function jugadoresDePlanilla() {
    const clave = $('#pl-equipo').value;
    return players.filter((p) => !clave || claveEquipo(p.equipo) === clave);
  }

  function resumenPlanilla() {
    const n = jugadoresDePlanilla().length;
    $('#pl-resumen').textContent = `${n} jugador${n === 1 ? '' : 'es'} en la planilla.`;
    $('#pl-imprimir').disabled = n === 0;
  }

  $('#btn-planilla').addEventListener('click', () => {
    if (!players.length) return toast('Todavía no hay jugadores para imprimir.');
    const equipos = equiposActuales();
    const sel = $('#pl-equipo');
    sel.replaceChildren(
      el('option', { value: '', text: 'Todos los equipos' }),
      ...equipos.map(([k, nombre]) => el('option', { value: k, text: nombre })),
    );
    sel.value = filtro.equipo; // empieza con el equipo que se está viendo en la lista
    resumenPlanilla();
    dlgPlanilla.showModal();
  });
  $('#pl-equipo').addEventListener('change', resumenPlanilla);

  $('#form-planilla').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const clave = $('#pl-equipo').value;
    const opcion = $('#pl-equipo').selectedOptions[0];
    const lista = jugadoresDePlanilla();
    if (!lista.length) return;
    dlgPlanilla.close();
    await imprimir(
      construirPlanilla(lista, {
        equipo: clave ? opcion.text : '',
        fotos: $('#pl-fotos').checked,
        firma: $('#pl-firma').checked,
        telefono: $('#pl-telefono').checked,
      }),
    );
  });

  /* ---------- Administrar (solo administradores) ---------- */

  iniciarAdmin({ api, getUsuario: () => usuario, getJugadores: () => players, toast });

  /* ---------- Cerrar diálogos ---------- */
  $$('[data-cerrar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
}
