import { firebaseConfig, CONFIGURADO } from './firebase-config.js';
import { procesarFoto, miniaturaDesde } from './images.js';
import { reconocerTexto } from './ocr.js';
import { parsearDocumento, validarDUI, formatearDUI, normalizar } from './parser.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

const vistas = {
  cargando: $('#vista-cargando'),
  config: $('#vista-config'),
  login: $('#vista-login'),
  app: $('#vista-app'),
};
function mostrarVista(nombre) {
  for (const [k, el] of Object.entries(vistas)) el.hidden = k !== nombre;
}

if (!CONFIGURADO) {
  mostrarVista('config');
} else {
  iniciar().catch((e) => {
    console.error(e);
    mostrarVista('login');
    mostrarLoginMsg('No se pudo iniciar la aplicación. Revisa tu conexión e inténtalo de nuevo.');
  });
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

let toastTimer;
function toast(msg, esError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (esError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function mostrarLoginMsg(msg) {
  const el = $('#login-msg');
  el.textContent = msg || '';
  el.hidden = !msg;
}

const fechaLegible = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const nombreCompleto = (p) => [p.nombres, p.apellidos].filter(Boolean).join(' ');
const etiquetaTipo = (t) => (t === 'DUI' ? 'DUI' : 'Carnet');

/* ------------------------------------------------------------------ */
/* Firebase                                                            */
/* ------------------------------------------------------------------ */

async function iniciar() {
  const V = '10.14.1';
  const base = `https://www.gstatic.com/firebasejs/${V}`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);

  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);

  let usuario = null;
  let cancelarEscucha = null;
  let mensajeLogin = '';
  let players = [];
  let filtro = 'todos';

  /* ---------- Sesión y control de acceso ---------- */

  $('#btn-login').addEventListener('click', async () => {
    mensajeLogin = '';
    mostrarLoginMsg('');
    try {
      await A.signInWithPopup(auth, new A.GoogleAuthProvider());
    } catch (e) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      if (e.code === 'auth/unauthorized-domain') {
        mostrarLoginMsg('Este dominio no está autorizado en Firebase (Authentication > Configuración > Dominios autorizados).');
      } else if (e.code === 'auth/popup-blocked') {
        mostrarLoginMsg('El navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo de nuevo.');
      } else {
        mostrarLoginMsg('No se pudo iniciar sesión. Inténtalo de nuevo.');
      }
      console.error(e);
    }
  });

  $('#btn-salir').addEventListener('click', () => A.signOut(auth));

  A.onAuthStateChanged(auth, async (user) => {
    cancelarEscucha?.();
    cancelarEscucha = null;
    usuario = null;
    players = [];

    if (!user) {
      mostrarVista('login');
      mostrarLoginMsg(mensajeLogin);
      return;
    }

    mostrarVista('cargando');
    let permitido = false;
    try {
      const email = (user.email || '').toLowerCase();
      if (user.emailVerified && email) {
        const snap = await F.getDoc(F.doc(db, 'allowed', email));
        permitido = snap.exists();
      }
    } catch (e) {
      console.warn('Verificación de acceso:', e.code || e);
    }

    if (!permitido) {
      mensajeLogin = `La cuenta ${user.email} no tiene permiso para entrar. Pide que la autoricen.`;
      await A.signOut(auth);
      return;
    }

    usuario = user;
    $('#usuario-email').textContent = user.email;
    mostrarVista('app');

    const q = F.query(F.collection(db, 'players'), F.orderBy('creadoEn', 'desc'));
    cancelarEscucha = F.onSnapshot(
      q,
      (snap) => {
        players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        pintarLista();
      },
      (e) => {
        console.error(e);
        toast('No se pudieron cargar los registros.', true);
      },
    );
  });

  /* ---------- Lista ---------- */

  function pintarLista() {
    const texto = normalizar($('#buscar').value.trim());
    const filtrados = players.filter((p) => {
      if (filtro !== 'todos' && p.tipo !== filtro) return false;
      if (!texto) return true;
      const pajar = normalizar([p.nombres, p.apellidos, p.numero, p.equipo, p.telefono].join(' '));
      return pajar.includes(texto);
    });

    const ul = $('#lista');
    ul.replaceChildren(...filtrados.map(crearItem));
    $('#vacio').hidden = players.length > 0;
    $('#resumen').textContent = players.length
      ? `${filtrados.length} de ${players.length} registro${players.length === 1 ? '' : 's'}`
      : '';
  }

  function crearItem(p) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'item';
    btn.type = 'button';

    const mini = document.createElement('div');
    mini.className = 'item-miniatura';
    if (p.miniatura) {
      const img = document.createElement('img');
      img.src = p.miniatura;
      img.alt = '';
      mini.append(img);
    } else {
      mini.textContent = (p.nombres || '?').charAt(0).toUpperCase();
    }

    const info = document.createElement('div');
    info.className = 'item-info';
    const n = document.createElement('div');
    n.className = 'item-nombre';
    n.textContent = nombreCompleto(p) || '(sin nombre)';
    const m = document.createElement('div');
    m.className = 'item-meta';
    m.textContent = [p.numero, p.equipo].filter(Boolean).join(' · ');
    info.append(n, m);

    const tag = document.createElement('span');
    tag.className = 'insignia';
    tag.textContent = etiquetaTipo(p.tipo);

    btn.append(mini, info, tag);
    btn.addEventListener('click', () => abrirDetalle(p.id));
    li.append(btn);
    return li;
  }

  $('#buscar').addEventListener('input', pintarLista);
  $$('.chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      filtro = chip.dataset.filtro;
      $$('.chip').forEach((c) => c.classList.toggle('activo', c === chip));
      pintarLista();
    }),
  );

  /* ---------- Exportar CSV ---------- */

  $('#btn-csv').addEventListener('click', () => {
    if (!players.length) return toast('No hay registros para exportar.');
    const celda = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita inyección de fórmulas en Excel
      return `"${s.replace(/"/g, '""')}"`;
    };
    const cab = ['Tipo', 'Número', 'Nombres', 'Apellidos', 'Fecha de nacimiento', 'Equipo', 'Teléfono', 'Notas', 'Registrado'];
    const filas = players.map((p) => [
      etiquetaTipo(p.tipo), p.numero, p.nombres, p.apellidos, fechaLegible(p.fechaNacimiento),
      p.equipo, p.telefono, p.notas, p.creadoEn?.toDate ? p.creadoEn.toDate().toLocaleString('es-SV') : '',
    ]);
    const csv = '﻿' + [cab, ...filas].map((f) => f.map(celda).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `jugadores-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* ---------- Detalle ---------- */

  const dlgDetalle = $('#dlg-detalle');
  let detalleId = null;

  async function abrirDetalle(id) {
    const p = players.find((x) => x.id === id);
    if (!p) return;
    detalleId = id;
    $('#det-titulo').textContent = nombreCompleto(p) || 'Detalle';

    const datos = [
      ['Tipo', p.tipo === 'DUI' ? 'DUI' : 'Carnet de fútbol'],
      [p.tipo === 'DUI' ? 'Número de DUI' : 'Número de carnet', p.numero],
      ['Nombres', p.nombres],
      ['Apellidos', p.apellidos],
      ['Nacimiento', fechaLegible(p.fechaNacimiento)],
      ['Equipo', p.equipo],
      ['Teléfono', p.telefono],
      ['Notas', p.notas],
      ['Registrado por', p.creadoPor],
    ].filter(([, v]) => v);
    $('#det-datos').replaceChildren(
      ...datos.map(([k, v]) => {
        const d = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        d.append(dt, dd);
        return d;
      }),
    );

    const cont = $('#det-fotos');
    cont.replaceChildren(Object.assign(document.createElement('p'), { className: 'cargando', textContent: 'Cargando fotos…' }));
    dlgDetalle.showModal();

    const fotos = await cargarFotos(id);
    if (detalleId !== id) return;
    cont.replaceChildren();
    for (const [lado, titulo] of [['frente', 'Frente'], ['reverso', 'Reverso']]) {
      if (!fotos[lado]) continue;
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = fotos[lado];
      img.alt = `${titulo} del documento`;
      const cap = document.createElement('figcaption');
      cap.textContent = titulo;
      fig.append(img, cap);
      cont.append(fig);
    }
    if (!cont.children.length) cont.hidden = true;
    else cont.hidden = false;
  }

  async function cargarFotos(id) {
    const out = { frente: null, reverso: null };
    try {
      await Promise.all(
        Object.keys(out).map(async (lado) => {
          const s = await F.getDoc(F.doc(db, 'players', id, 'fotos', lado));
          if (s.exists()) out[lado] = s.data().data;
        }),
      );
    } catch (e) {
      console.error(e);
      toast('No se pudieron cargar las fotos.', true);
    }
    return out;
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
    if (!confirm(`¿Eliminar a ${nombreCompleto(p) || 'este registro'}?\nSe borrarán también sus fotos y no se puede deshacer.`)) return;
    try {
      const lote = F.writeBatch(db);
      lote.delete(F.doc(db, 'players', p.id, 'fotos', 'frente'));
      lote.delete(F.doc(db, 'players', p.id, 'fotos', 'reverso'));
      lote.delete(F.doc(db, 'players', p.id));
      await lote.commit();
      dlgDetalle.close();
      toast('Registro eliminado.');
    } catch (e) {
      console.error(e);
      toast('No se pudo eliminar.', true);
    }
  });

  /* ---------- Formulario ---------- */

  const dlgForm = $('#dlg-form');
  const form = $('#form');
  const campos = {
    numero: $('#f-numero'),
    nombres: $('#f-nombres'),
    apellidos: $('#f-apellidos'),
    fechaNacimiento: $('#f-nacimiento'),
    equipo: $('#f-equipo'),
    telefono: $('#f-telefono'),
    notas: $('#f-notas'),
  };
  // Campos que la persona ya escribió a mano: el OCR no los pisa.
  const tocados = new Set();
  for (const [nombre, el] of Object.entries(campos)) el.addEventListener('input', () => tocados.add(nombre));

  let editando = null; // registro en edición o null
  let fotos = {}; // { frente: {dataUrl, cambiada}, reverso: {...} }
  let textosOcr = {}; // { frente: '...', reverso: '...' }
  let colaOcr = Promise.resolve();
  let guardando = false;

  const tipoActual = () => form.elements.tipo.value;

  function actualizarTipoUI() {
    const dui = tipoActual() === 'DUI';
    $('#lbl-numero').textContent = dui ? 'Número de DUI *' : 'Número de carnet *';
    campos.numero.placeholder = dui ? '00000000-0' : '';
    campos.numero.inputMode = dui ? 'numeric' : 'text';
    validarNumeroUI();
  }

  function validarNumeroUI() {
    const ayuda = $('#numero-ayuda');
    const v = campos.numero.value.trim();
    ayuda.className = 'campo-ayuda';
    ayuda.textContent = '';
    if (tipoActual() !== 'DUI' || !v) return;
    if (validarDUI(v)) {
      ayuda.textContent = 'Dígito verificador correcto';
      ayuda.classList.add('ok');
    } else {
      ayuda.textContent = 'El dígito verificador no coincide: revisa el número contra la foto.';
      ayuda.classList.add('warn');
    }
  }

  campos.numero.addEventListener('input', validarNumeroUI);
  campos.numero.addEventListener('blur', () => {
    if (tipoActual() === 'DUI') {
      const f = formatearDUI(campos.numero.value);
      if (f !== campos.numero.value) campos.numero.value = f;
      validarNumeroUI();
    }
  });
  $$('input[name="tipo"]').forEach((r) =>
    r.addEventListener('change', () => {
      actualizarTipoUI();
      aplicarOcr();
    }),
  );

  function pintarFoto(lado) {
    const cont = $(`.foto[data-lado="${lado}"]`);
    const marco = $('.foto-marco', cont);
    const f = fotos[lado];
    $('img', marco)?.remove();
    marco.classList.toggle('con-foto', !!f);
    $('.foto-vacio', marco).hidden = !!f;
    if (f) {
      const img = document.createElement('img');
      img.src = f.dataUrl;
      img.alt = `Foto ${lado}`;
      marco.prepend(img);
    }
    $('[data-quitar]', cont).hidden = !f;
  }

  $$('.foto').forEach((cont) => {
    const lado = cont.dataset.lado;
    $$('input[type="file"]', cont).forEach((inp) =>
      inp.addEventListener('change', async () => {
        const archivo = inp.files[0];
        inp.value = '';
        if (archivo) await alElegirFoto(lado, archivo);
      }),
    );
    $('[data-quitar]', cont).addEventListener('click', () => {
      delete fotos[lado];
      delete textosOcr[lado];
      pintarFoto(lado);
    });
  });

  async function alElegirFoto(lado, archivo) {
    if (!archivo.type.startsWith('image/')) return toast('Elige un archivo de imagen.', true);
    let proc;
    try {
      proc = await procesarFoto(archivo);
    } catch (e) {
      console.error(e);
      return toast('No se pudo leer esa imagen.', true);
    }
    fotos[lado] = { dataUrl: proc.dataUrl, cambiada: true };
    pintarFoto(lado);

    // Los OCR se hacen de uno en uno para no saturar el teléfono.
    colaOcr = colaOcr.then(() => ejecutarOcr(lado, proc.ocrCanvas));
  }

  function estadoOcr(visible, texto = '', progreso = null) {
    const caja = $('#ocr-estado');
    caja.hidden = !visible;
    caja.classList.toggle('indeterminado', visible && progreso === null);
    $('#ocr-progreso').style.width = progreso === null ? '' : `${Math.round(progreso * 100)}%`;
    $('#ocr-texto').textContent = texto;
  }

  async function ejecutarOcr(lado, canvas) {
    const etiqueta = lado === 'frente' ? 'frente' : 'reverso';
    try {
      estadoOcr(true, `Preparando el lector de texto (${etiqueta})… la primera vez tarda un poco.`);
      const texto = await reconocerTexto(canvas, (p) => {
        if (p !== null) estadoOcr(true, `Leyendo ${etiqueta} del documento… ${Math.round(p * 100)}%`, p);
      });
      if (!fotos[lado]) return; // la quitaron mientras se leía
      textosOcr[lado] = texto;
      const antes = JSON.stringify(valoresActuales());
      aplicarOcr();
      const cambio = antes !== JSON.stringify(valoresActuales());
      toast(cambio ? 'Datos leídos. Revísalos antes de guardar.' : 'No se pudo leer datos claros; escríbelos a mano.');
    } catch (e) {
      console.error(e);
      toast(e.message || 'No se pudo leer el texto de la foto.', true);
    } finally {
      estadoOcr(false);
    }
  }

  const valoresActuales = () => Object.fromEntries(Object.entries(campos).map(([k, el]) => [k, el.value]));

  function aplicarOcr() {
    const texto = [textosOcr.frente, textosOcr.reverso].filter(Boolean).join('\n');
    if (!texto) return;
    const r = parsearDocumento(tipoActual(), texto);
    for (const [k, v] of Object.entries(r)) {
      if (v && campos[k] && !tocados.has(k)) campos[k].value = v;
    }
    validarNumeroUI();
  }

  async function abrirFormulario(registro = null) {
    editando = registro;
    fotos = {};
    textosOcr = {};
    tocados.clear();
    form.reset();
    $('#form-error').hidden = true;
    estadoOcr(false);
    $('#form-titulo').textContent = registro ? 'Editar registro' : 'Nuevo registro';
    $('#btn-guardar').textContent = registro ? 'Guardar cambios' : 'Guardar';

    if (registro) {
      form.elements.tipo.value = registro.tipo || 'DUI';
      for (const [k, el] of Object.entries(campos)) el.value = registro[k] || '';
      for (const k of Object.keys(campos)) tocados.add(k);
    }
    actualizarTipoUI();
    pintarFoto('frente');
    pintarFoto('reverso');
    dlgForm.showModal();

    if (registro) {
      const previas = await cargarFotos(registro.id);
      if (editando?.id !== registro.id) return;
      for (const lado of ['frente', 'reverso']) {
        if (previas[lado] && !fotos[lado]) {
          fotos[lado] = { dataUrl: previas[lado], cambiada: false };
          pintarFoto(lado);
        }
      }
    }
  }

  $('#btn-nuevo').addEventListener('click', () => abrirFormulario());

  function errorForm(msg) {
    const el = $('#form-error');
    el.textContent = msg;
    el.hidden = !msg;
    if (msg) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (guardando) return;
    errorForm('');

    const tipo = tipoActual();
    const datos = {
      tipo,
      numero: tipo === 'DUI' ? formatearDUI(campos.numero.value.trim()) : campos.numero.value.trim(),
      nombres: campos.nombres.value.trim(),
      apellidos: campos.apellidos.value.trim(),
      fechaNacimiento: campos.fechaNacimiento.value,
      equipo: campos.equipo.value.trim(),
      telefono: campos.telefono.value.trim(),
      notas: campos.notas.value.trim(),
    };

    if (!datos.numero) return errorForm(`Escribe el número de ${tipo === 'DUI' ? 'DUI' : 'carnet'}.`);
    if (!datos.nombres) return errorForm('Escribe los nombres.');
    if (!fotos.frente && !fotos.reverso) return errorForm('Agrega al menos una foto del documento.');

    const repetido = players.find((p) => p.id !== editando?.id && p.tipo === tipo && normalizar(p.numero) === normalizar(datos.numero));
    if (repetido && !confirm(`Ya existe un registro con ese número (${nombreCompleto(repetido)}). ¿Guardar de todas formas?`)) return;

    guardando = true;
    const btn = $('#btn-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const refPlayer = editando ? F.doc(db, 'players', editando.id) : F.doc(F.collection(db, 'players'));
      const hayCambios = Object.values(fotos).some((f) => f.cambiada) || (editando && ['frente', 'reverso'].some((l) => !fotos[l]));
      const fuenteMini = fotos.frente?.dataUrl || fotos.reverso?.dataUrl;
      datos.miniatura = !editando || hayCambios ? await miniaturaDesde(fuenteMini) : editando.miniatura || '';

      const lote = F.writeBatch(db);
      if (editando) {
        lote.update(refPlayer, { ...datos, actualizadoEn: F.serverTimestamp(), actualizadoPor: usuario.email });
      } else {
        lote.set(refPlayer, { ...datos, creadoEn: F.serverTimestamp(), creadoPor: usuario.email });
      }
      for (const lado of ['frente', 'reverso']) {
        const refFoto = F.doc(db, 'players', refPlayer.id, 'fotos', lado);
        if (fotos[lado]?.cambiada) lote.set(refFoto, { data: fotos[lado].dataUrl });
        else if (!fotos[lado] && editando) lote.delete(refFoto);
      }
      await lote.commit();

      dlgForm.close();
      toast(editando ? 'Cambios guardados.' : 'Registro guardado.');
    } catch (e) {
      console.error(e);
      errorForm(e.code === 'permission-denied'
        ? 'No tienes permiso para guardar. Vuelve a iniciar sesión.'
        : 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      guardando = false;
      btn.disabled = false;
      btn.textContent = editando ? 'Guardar cambios' : 'Guardar';
    }
  });

  /* ---------- Cerrar diálogos ---------- */
  $$('[data-cerrar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  dlgDetalle.addEventListener('close', () => { detalleId = null; });
}
