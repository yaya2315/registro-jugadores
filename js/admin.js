// Pantalla "Administrar" (solo administradores): usuarios autorizados, administradores y respaldo.
//
// Importante: esta pantalla solo es comodidad. Quien puede cambiar la lista de usuarios lo decide
// firestore.rules en el servidor; un usuario normal no podría hacerlo aunque abriera la pantalla.

import { $, el } from './util.js';
import { generarRespaldo, descargar } from './respaldo.js';

const CORREO_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function iniciarAdmin({ api, getUsuario, getJugadores, toast }) {
  const dlg = $('#dlg-admin');
  const form = $('#form-usuario');
  const btnRespaldo = $('#btn-respaldo');
  let detener = null;
  let usuarios = [];
  let ocupado = false;

  function abrir() {
    $('#usuario-error').hidden = true;
    dlg.showModal();
    detener?.();
    detener = api.escucharUsuarios(
      (lista) => { usuarios = lista; pintar(); },
      (e) => { console.error(e); toast('No se pudo leer la lista de usuarios.', true); },
    );
  }
  $('#btn-admin').addEventListener('click', abrir);
  dlg.addEventListener('close', () => { detener?.(); detener = null; });

  function error(msg) {
    const e = $('#usuario-error');
    e.textContent = msg;
    e.hidden = !msg;
  }

  /** Ejecuta una acción de administración y avisa si falla (p. ej. si las reglas no la permiten). */
  async function accion(texto, fn) {
    if (ocupado) return;
    ocupado = true;
    try {
      await fn();
      if (texto) toast(texto);
    } catch (e) {
      console.error(e);
      toast(e.code === 'permission-denied' ? 'No tienes permiso para hacer eso.' : 'No se pudo guardar el cambio. Revisa tu conexión.', true);
    } finally {
      ocupado = false;
    }
  }

  function fila(u) {
    const yo = getUsuario().email.toLowerCase() === u.email;
    const acciones = yo
      ? null
      : el(
          'div',
          { class: 'usuario-acciones' },
          el('button', {
            type: 'button',
            class: 'btn secundario peq',
            text: u.admin ? 'Quitar administrador' : 'Hacer administrador',
            onclick: () => {
              const msg = u.admin ? `¿Quitar el rol de administrador a ${u.email}? Seguirá pudiendo entrar a la app.` : `¿Dar rol de administrador a ${u.email}? Podrá agregar y quitar usuarios y descargar respaldos.`;
              if (confirm(msg)) accion(u.admin ? 'Ya no es administrador.' : 'Ahora es administrador.', () => api.actualizarUsuario(u.email, { admin: !u.admin }));
            },
          }),
          el('button', {
            type: 'button',
            class: 'btn texto peq peligro',
            text: 'Quitar acceso',
            onclick: () => {
              if (confirm(`¿Quitar el acceso a ${u.email}? Ya no podrá entrar a la app.`)) accion('Acceso quitado.', () => api.quitarUsuario(u.email));
            },
          }),
        );
    return el(
      'li',
      { class: 'usuario' },
      el(
        'div',
        { class: 'usuario-info' },
        el('strong', { text: u.nombre || u.email }),
        u.nombre ? el('span', { class: 'usuario-correo', text: u.email }) : null,
        el(
          'div',
          { class: 'etiquetas' },
          el('span', { class: `etiqueta${u.admin ? '' : ' suave'}`, text: u.admin ? 'Administrador' : 'Usuario' }),
          yo ? el('span', { class: 'etiqueta suave', text: 'Tú' }) : null,
        ),
      ),
      acciones,
    );
  }

  function pintar() {
    const ordenados = [...usuarios].sort((a, b) => Number(b.admin) - Number(a.admin) || a.email.localeCompare(b.email));
    $('#lista-usuarios').replaceChildren(...ordenados.map(fila));
    $('#usuarios-resumen').textContent = `${usuarios.length} usuario${usuarios.length === 1 ? '' : 's'} · ${usuarios.filter((u) => u.admin).length} administrador${usuarios.filter((u) => u.admin).length === 1 ? '' : 'es'}`;
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    error('');
    const email = $('#u-correo').value.trim().toLowerCase();
    const nombre = $('#u-nombre').value.trim().slice(0, 80);
    const admin = $('#u-admin').checked;
    if (!CORREO_VALIDO.test(email)) return error('Escribe un correo válido.');
    if (usuarios.some((u) => u.email === email)) return error('Ese correo ya está en la lista.');
    accion(`${email} ya puede entrar.`, async () => {
      await api.crearUsuario({ email, nombre, admin, por: getUsuario().email });
      form.reset();
    });
  });

  btnRespaldo.addEventListener('click', async () => {
    const jugadores = getJugadores();
    if (!jugadores.length) return toast('Todavía no hay jugadores para respaldar.');
    const estado = $('#respaldo-estado');
    btnRespaldo.disabled = true;
    estado.hidden = false;
    try {
      const { blob, nombre, resumen } = await generarRespaldo(jugadores, api, usuarios, (hecho, total) => {
        estado.textContent = `Preparando el respaldo… ${hecho} de ${total} jugadores`;
      });
      descargar(blob, nombre);
      const mb = (blob.size / 1048576).toFixed(1);
      estado.textContent = `Listo: ${resumen.jugadores} jugadores y ${resumen.fotos} fotos (${mb} MB). Revisa tu carpeta de descargas.`;
      if (resumen.sinFotos) toast(`Atención: no se pudieron leer las fotos de ${resumen.sinFotos} jugador(es).`, true);
    } catch (e) {
      console.error(e);
      estado.textContent = 'No se pudo preparar el respaldo. Revisa tu conexión e inténtalo de nuevo.';
      toast('No se pudo preparar el respaldo.', true);
    } finally {
      btnRespaldo.disabled = false;
    }
  });
}
