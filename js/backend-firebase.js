// Acceso a Firebase (login con Google + Firestore). La app solo habla con esta interfaz.
//
// Colecciones:
//   allowed/{correo}                         correos autorizados (solo desde la consola de Firebase)
//   players/{id}                             datos del jugador (incluye "foto", el retrato 3:4)
//   players/{id}/fotos/{clave}               fotos de documentos: dui_frente, dui_reverso,
//                                            carnet_frente, carnet_reverso  ->  { data: dataURL }
//                                            (frente / reverso: formato anterior, se sigue leyendo)

import { firebaseConfig } from './firebase-config.js';

const VERSION = '10.14.1';
const BASE = `https://www.gstatic.com/firebasejs/${VERSION}`;

export const CLAVES_FOTO = ['dui_frente', 'dui_reverso', 'carnet_frente', 'carnet_reverso'];
const CLAVES_ANTIGUAS = ['frente', 'reverso'];

export async function crear() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);

  let aviso = ''; // motivo del último rechazo, para mostrarlo en la pantalla de acceso

  const refFoto = (id, clave) => F.doc(db, 'players', id, 'fotos', clave);

  return {
    /** cb(usuario | null, aviso). Solo llama con usuario si el correo está en "allowed". */
    alCambiarSesion(cb) {
      return A.onAuthStateChanged(auth, async (user) => {
        if (!user) return cb(null, aviso);
        let permitido = false;
        try {
          const email = (user.email || '').toLowerCase();
          if (user.emailVerified && email) {
            permitido = (await F.getDoc(F.doc(db, 'allowed', email))).exists();
          }
        } catch (e) {
          console.warn('Verificación de acceso:', e.code || e);
        }
        if (!permitido) {
          aviso = `La cuenta ${user.email} no tiene permiso para entrar. Pide que la autoricen.`;
          await A.signOut(auth); // dispara otra vez este evento con user = null
          return;
        }
        cb({ email: user.email });
      });
    },

    async iniciarSesion() {
      aviso = '';
      await A.signInWithPopup(auth, new A.GoogleAuthProvider());
    },

    cerrarSesion: () => A.signOut(auth),

    /** Escucha la lista de jugadores en tiempo real. Devuelve la función para dejar de escuchar. */
    escuchar(cb, cbError) {
      const q = F.query(F.collection(db, 'players'), F.orderBy('creadoEn', 'desc'));
      return F.onSnapshot(
        q,
        (snap) => cb(snap.docs.map((d) => {
          const x = d.data();
          return { id: d.id, ...x, creadoEn: x.creadoEn?.toDate?.() ?? null };
        })),
        cbError,
      );
    },

    /**
     * @param {{id?: string, datos: object, fotos: Record<string,string|null>, usuario: string, borrarAntiguas?: boolean}} p
     *   fotos: clave -> dataURL (guardar) o null (borrar)
     */
    async guardar({ id, datos, fotos, usuario, borrarAntiguas }) {
      const ref = id ? F.doc(db, 'players', id) : F.doc(F.collection(db, 'players'));
      const lote = F.writeBatch(db);
      if (id) {
        lote.update(ref, { ...datos, miniatura: F.deleteField(), actualizadoEn: F.serverTimestamp(), actualizadoPor: usuario });
      } else {
        lote.set(ref, { ...datos, creadoEn: F.serverTimestamp(), creadoPor: usuario });
      }
      for (const [clave, data] of Object.entries(fotos)) {
        if (data) lote.set(refFoto(ref.id, clave), { data });
        else lote.delete(refFoto(ref.id, clave));
      }
      if (borrarAntiguas) for (const c of CLAVES_ANTIGUAS) lote.delete(refFoto(ref.id, c));
      await lote.commit();
      return ref.id;
    },

    async eliminar(id) {
      const lote = F.writeBatch(db);
      for (const c of [...CLAVES_FOTO, ...CLAVES_ANTIGUAS]) lote.delete(refFoto(id, c));
      lote.delete(F.doc(db, 'players', id));
      await lote.commit();
    },

    /** @returns {Promise<Record<string,string>>} clave -> dataURL (solo las que existen) */
    async cargarFotos(id, { incluirAntiguas = false } = {}) {
      const claves = incluirAntiguas ? [...CLAVES_FOTO, ...CLAVES_ANTIGUAS] : CLAVES_FOTO;
      const out = {};
      await Promise.all(claves.map(async (c) => {
        const s = await F.getDoc(refFoto(id, c));
        if (s.exists()) out[c] = s.data().data;
      }));
      return out;
    },
  };
}
