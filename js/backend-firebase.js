// Acceso a Firebase (login con Google + Firestore). La app solo habla con esta interfaz.
//
// Colecciones:
//   allowed/{correo}                         correos autorizados (solo desde la consola de Firebase)
//   players/{id}                             datos del jugador (incluye "foto", el retrato 3:4)
//   players/{id}/fotos/{clave}               fotos de documentos: dui_frente, dui_reverso,
//                                            carnet_frente, carnet_reverso  ->  { data: dataURL }
//                                            (frente / reverso: formato anterior, se sigue leyendo)

import { firebaseConfig } from './firebase-config.js';
import { claveDocumento } from './parser.js';

const TIPOS = ['dui', 'carnet'];

/** Error que la app reconoce (code 'repetido') cuando el DUI o carnet ya es de otro jugador. */
export function errorRepetido(tipo, jugadorId) {
  return Object.assign(new Error('DUI o carnet repetido'), { code: 'repetido', tipo, jugadorId });
}

const VERSION = '10.14.1';
const BASE = `https://www.gstatic.com/firebasejs/${VERSION}`;

export const CLAVES_FOTO = ['dui_frente', 'dui_reverso', 'carnet_frente', 'carnet_reverso'];
const CLAVES_ANTIGUAS = ['frente', 'reverso'];

/** @param {{sdk?: {app: object, auth: object, firestore: object}}} [opciones]  `sdk` solo se usa en las pruebas */
export async function crear({ sdk } = {}) {
  const [{ initializeApp }, A, F] = sdk
    ? [sdk.app, sdk.auth, sdk.firestore]
    : await Promise.all([
        import(`${BASE}/firebase-app.js`),
        import(`${BASE}/firebase-auth.js`),
        import(`${BASE}/firebase-firestore.js`),
      ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);

  let aviso = ''; // motivo del último rechazo, para mostrarlo en la pantalla de acceso

  const refFoto = (id, clave) => F.doc(db, 'players', id, 'fotos', clave);

  // "Llaves" de documentos: documentos/dui_054821351, documentos/carnet_FB00123 -> { jugadorId }.
  // Firestore no deja crear dos veces la misma llave (las reglas no permiten actualizarla), y
  // como se escribe dentro de la misma transacción que el jugador, el DUI/carnet queda único
  // aunque dos personas escaneen al mismo jugador al mismo tiempo.
  const refLlave = (tipo, clave) => F.doc(db, 'documentos', `${tipo}_${clave}`);
  const clavesDe = (d) => ({ dui: claveDocumento('dui', d.dui), carnet: claveDocumento('carnet', d.carnet) });

  return {
    /** cb(usuario | null, aviso). Solo llama con usuario si el correo está en "allowed". */
    alCambiarSesion(cb) {
      return A.onAuthStateChanged(auth, async (user) => {
        if (!user) return cb(null, aviso);
        let acceso = null;
        try {
          const email = (user.email || '').toLowerCase();
          if (user.emailVerified && email) {
            const snap = await F.getDoc(F.doc(db, 'allowed', email));
            if (snap.exists()) acceso = snap.data();
          }
        } catch (e) {
          console.warn('Verificación de acceso:', e.code || e);
        }
        if (!acceso) {
          aviso = `La cuenta ${user.email} no tiene permiso para entrar. Pide que la autoricen.`;
          await A.signOut(auth); // dispara otra vez este evento con user = null
          return;
        }
        cb({ email: user.email, admin: acceso.admin === true });
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
      const nuevas = clavesDe(datos);

      // Todo en una transacción: o se guarda el jugador con sus llaves, o no se guarda nada.
      const ejecutar = (conLlaves) =>
        F.runTransaction(db, async (tx) => {
          // 1) Lecturas (Firestore exige leer antes de escribir)
          const previo = id ? await tx.get(ref) : null;
          const viejas = conLlaves && previo?.exists() ? clavesDe(previo.data()) : {};
          const llaves = {};
          if (conLlaves) {
            for (const tipo of TIPOS) {
              for (const clave of new Set([nuevas[tipo], viejas[tipo]])) {
                if (clave) llaves[`${tipo}_${clave}`] = { ref: refLlave(tipo, clave), snap: await tx.get(refLlave(tipo, clave)) };
              }
            }
            // 2) Ese DUI o carnet no puede pertenecer ya a otro jugador
            for (const tipo of TIPOS) {
              const clave = nuevas[tipo];
              if (!clave) continue;
              const snap = llaves[`${tipo}_${clave}`].snap;
              if (snap.exists() && snap.data().jugadorId !== ref.id) throw errorRepetido(tipo, snap.data().jugadorId);
            }
          }

          // 3) Escrituras: jugador, llaves nuevas, llaves viejas ya sin uso y fotos
          if (id) {
            tx.update(ref, { ...datos, miniatura: F.deleteField(), actualizadoEn: F.serverTimestamp(), actualizadoPor: usuario });
          } else {
            tx.set(ref, { ...datos, creadoEn: F.serverTimestamp(), creadoPor: usuario });
          }
          if (conLlaves) {
            for (const tipo of TIPOS) {
              const nueva = nuevas[tipo];
              const vieja = viejas[tipo];
              if (nueva) {
                const l = llaves[`${tipo}_${nueva}`];
                if (!l.snap.exists()) tx.set(l.ref, { jugadorId: ref.id, tipo, creadoEn: F.serverTimestamp() });
              }
              if (vieja && vieja !== nueva) {
                const l = llaves[`${tipo}_${vieja}`];
                if (l.snap.exists() && l.snap.data().jugadorId === ref.id) tx.delete(l.ref);
              }
            }
          }
          for (const [clave, data] of Object.entries(fotos)) {
            if (data) tx.set(refFoto(ref.id, clave), { data });
            else tx.delete(refFoto(ref.id, clave));
          }
          if (borrarAntiguas) for (const c of CLAVES_ANTIGUAS) tx.delete(refFoto(ref.id, c));
        });

      let sinLlaves = false;
      try {
        await ejecutar(true);
      } catch (e) {
        if (e.code !== 'permission-denied') throw e;
        // Casi seguro todavía no se publicaron las reglas nuevas (colección "documentos"). En vez de
        // dejar a todos sin poder guardar, se guarda sin las llaves; la pantalla sigue avisando de repetidos.
        console.warn('Firestore rechazó las llaves de documentos: falta publicar firestore.rules. Se guarda sin ellas.');
        await ejecutar(false);
        sinLlaves = true;
      }
      return { id: ref.id, sinLlaves };
    },

    async eliminar(id) {
      const ref = F.doc(db, 'players', id);
      const ejecutar = (conLlaves) =>
        F.runTransaction(db, async (tx) => {
          const llaves = [];
          if (conLlaves) {
            const snap = await tx.get(ref);
            const claves = snap.exists() ? clavesDe(snap.data()) : {};
            for (const tipo of TIPOS) {
              if (claves[tipo]) llaves.push({ ref: refLlave(tipo, claves[tipo]), snap: await tx.get(refLlave(tipo, claves[tipo])) });
            }
          }
          // Se libera el DUI/carnet para poder registrarlo de nuevo, pero solo si la llave era de este jugador.
          for (const l of llaves) if (l.snap.exists() && l.snap.data().jugadorId === id) tx.delete(l.ref);
          for (const c of [...CLAVES_FOTO, ...CLAVES_ANTIGUAS]) tx.delete(refFoto(id, c));
          tx.delete(ref);
        });
      try {
        await ejecutar(true);
      } catch (e) {
        if (e.code !== 'permission-denied') throw e;
        await ejecutar(false); // reglas anteriores: se borra sin tocar las llaves
      }
    },

    /* ---------- Usuarios autorizados (solo administradores; lo exigen las reglas) ---------- */

    escucharUsuarios(cb, cbError) {
      return F.onSnapshot(
        F.collection(db, 'allowed'),
        (snap) => cb(snap.docs.map((d) => {
          const x = d.data();
          return { email: d.id, nombre: x.nombre || '', admin: x.admin === true, agregadoPor: x.agregadoPor || '', agregadoEn: x.agregadoEn?.toDate?.() ?? null };
        })),
        cbError,
      );
    },

    async crearUsuario({ email, nombre, admin, por }) {
      await F.setDoc(F.doc(db, 'allowed', email), { nombre, admin: !!admin, agregadoPor: por, agregadoEn: F.serverTimestamp() });
    },

    async actualizarUsuario(email, cambios) {
      await F.updateDoc(F.doc(db, 'allowed', email), cambios);
    },

    async quitarUsuario(email) {
      await F.deleteDoc(F.doc(db, 'allowed', email));
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
