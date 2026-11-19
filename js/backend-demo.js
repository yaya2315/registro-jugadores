// Modo demostración: mismos métodos que backend-firebase.js pero en memoria.
// Solo se activa en localhost con ?demo (ver app.js). Sirve para probar la interfaz sin tocar la base real.

const retratoSvg = (fondo, piel, camisa) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="${fondo}"/>` +
    `<circle cx="150" cy="150" r="62" fill="${piel}"/><path d="M40 400c0-85 50-125 110-125s110 40 110 125Z" fill="${camisa}"/></svg>`,
  );

const hace = (dias) => new Date(Date.now() - dias * 86400000);

const SEMILLA = [
  { nombres: 'Juan Carlos', apellidos: 'Pérez Martínez', fechaNacimiento: '2001-06-14', equipo: 'Águilas FC', posicion: 'Delantero', camiseta: '9', dui: '12345678-4', carnet: 'FB-00123', telefono: '7777-1234', notas: '', foto: retratoSvg('#9ec5e8', '#e0ac82', '#c0392b'), creadoEn: hace(1) },
  { nombres: 'Luis Alberto', apellidos: 'Ramos', fechaNacimiento: '1998-11-03', equipo: 'Halcones', posicion: 'Portero', camiseta: '1', dui: '05482135-1', carnet: '', telefono: '', notas: 'Falta entregar el carnet.', foto: retratoSvg('#b7d9a8', '#c68a62', '#2c3e50'), creadoEn: hace(2) },
  { nombres: 'María José', apellidos: 'López García', fechaNacimiento: '2004-02-21', equipo: 'Águilas FC', posicion: 'Mediocampista', camiseta: '8', dui: '', carnet: 'FB-00456', telefono: '7000-9876', notas: '', foto: '', creadoEn: hace(5) },
];

export const CLAVES_FOTO = ['dui_frente', 'dui_reverso', 'carnet_frente', 'carnet_reverso'];

export async function crear() {
  let jugadores = SEMILLA.map((p, i) => ({ id: `demo${i + 1}`, ...p }));
  const fotosDoc = new Map(); // `${id}/${clave}` -> dataURL
  const oyentes = new Set();
  const emitir = () => oyentes.forEach((cb) => cb(jugadores.map((p) => ({ ...p }))));

  return {
    alCambiarSesion(cb) {
      setTimeout(() => cb({ email: 'demo@local' }, ''), 50);
      return () => {};
    },
    async iniciarSesion() {},
    async cerrarSesion() { location.reload(); },
    escuchar(cb) {
      oyentes.add(cb);
      setTimeout(emitir, 50);
      return () => oyentes.delete(cb);
    },
    async guardar({ id, datos, fotos, usuario }) {
      const nuevoId = id || `demo${Date.now()}`;
      const previo = jugadores.find((p) => p.id === nuevoId);
      const reg = { ...previo, ...datos, id: nuevoId, creadoEn: previo?.creadoEn ?? new Date(), creadoPor: previo?.creadoPor ?? usuario };
      jugadores = previo ? jugadores.map((p) => (p.id === nuevoId ? reg : p)) : [reg, ...jugadores];
      for (const [clave, data] of Object.entries(fotos)) {
        if (data) fotosDoc.set(`${nuevoId}/${clave}`, data);
        else fotosDoc.delete(`${nuevoId}/${clave}`);
      }
      emitir();
      return nuevoId;
    },
    async eliminar(id) {
      jugadores = jugadores.filter((p) => p.id !== id);
      emitir();
    },
    async cargarFotos(id) {
      const out = {};
      for (const c of CLAVES_FOTO) if (fotosDoc.has(`${id}/${c}`)) out[c] = fotosDoc.get(`${id}/${c}`);
      return out;
    },
  };
}
