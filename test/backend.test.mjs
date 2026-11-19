// Prueba de la lógica de guardado de backend-firebase.js contra una base de datos simulada.
// La simulación imita lo que importa de Firestore:
//   - las transacciones leen primero y escriben después (leer tras escribir falla),
//   - las escrituras se aplican todas juntas o ninguna,
//   - crear una "llave" en documentos/ que ya existe equivale a actualizarla, y las reglas lo prohíben,
//   - las transacciones se ejecutan una a una (como el reintento de Firestore ante conflictos).

import assert from 'node:assert/strict';
import { crear } from '../js/backend-firebase.js';

function baseSimulada() {
  const datos = new Map();
  const TS = Symbol('serverTimestamp');
  const BORRAR = Symbol('deleteField');
  let n = 0;
  let turno = Promise.resolve();
  const estado = { sinReglasDeDocumentos: false };

  const F = {
    getFirestore: () => ({}),
    collection: (_db, ...ruta) => ({ coleccion: ruta.join('/') }),
    // Igual que Firestore, cada referencia tiene su `id` (el último tramo de la ruta)
    doc: (a, ...tramos) => {
      const ruta = a.coleccion ? `${a.coleccion}/auto${++n}` : tramos.join('/');
      return { ruta, id: ruta.split('/').pop() };
    },
    serverTimestamp: () => TS,
    deleteField: () => BORRAR,
    runTransaction(_db, fn) {
      const intento = turno.then(async () => {
        const escrituras = [];
        const tx = {
          get: async (ref) => {
            if (estado.sinReglasDeDocumentos && ref.ruta.startsWith('documentos/')) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
            if (escrituras.length) throw new Error('Firestore: las lecturas de una transacción van antes de las escrituras');
            return { exists: () => datos.has(ref.ruta), data: () => datos.get(ref.ruta) };
          },
          set: (ref, d) => escrituras.push(['set', ref.ruta, d]),
          update: (ref, d) => escrituras.push(['update', ref.ruta, d]),
          delete: (ref) => escrituras.push(['delete', ref.ruta]),
        };
        const resultado = await fn(tx);
        // Validación previa (reglas): nada se aplica si alguna escritura falla
        for (const [tipo, ruta] of escrituras) {
          if (tipo === 'set' && ruta.startsWith('documentos/') && datos.has(ruta)) {
            throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
          }
          if (tipo === 'update' && !datos.has(ruta)) throw Object.assign(new Error('not-found'), { code: 'not-found' });
        }
        for (const [tipo, ruta, d] of escrituras) {
          if (tipo === 'set') datos.set(ruta, { ...d });
          else if (tipo === 'update') {
            const actual = { ...datos.get(ruta) };
            for (const [k, v] of Object.entries(d)) {
              if (v === BORRAR) delete actual[k];
              else actual[k] = v;
            }
            datos.set(ruta, actual);
          } else datos.delete(ruta);
        }
        return resultado;
      });
      turno = intento.catch(() => {});
      return intento;
    },
  };
  return { F, datos, estado };
}

const { F, datos, estado } = baseSimulada();
const api = await crear({
  sdk: {
    app: { initializeApp: () => ({}) },
    auth: { getAuth: () => ({}) },
    firestore: F,
  },
});

const crearId = async (args) => (await api.guardar(args)).id;
const jugadores = () => [...datos.keys()].filter((k) => /^players\/[^/]+$/.test(k));
const llaves = () => [...datos.keys()].filter((k) => k.startsWith('documentos/')).sort();
const rechaza = async (promesa, tipo) => {
  await assert.rejects(promesa, (e) => e.code === 'repetido' && (!tipo || e.tipo === tipo));
};

// 1) Un jugador nuevo crea sus llaves
const idA = await crearId({ datos: { nombres: 'Ana', dui: '05482135-1', carnet: 'FB-001' }, fotos: { dui_frente: 'data:x' }, usuario: 'u' });
assert.deepEqual(llaves(), ['documentos/carnet_FB001', 'documentos/dui_054821351']);
assert.equal(datos.get('documentos/dui_054821351').jugadorId, idA);
assert.ok(datos.has(`players/${idA}/fotos/dui_frente`));

// 2) Otro jugador NUEVO con el mismo DUI (aunque escrito distinto) se rechaza y no deja nada
await rechaza(api.guardar({ datos: { nombres: 'Otra Ana', dui: '0548 2135-1' }, fotos: {}, usuario: 'u' }), 'dui');
assert.equal(jugadores().length, 1, 'no debe crearse un segundo jugador');

// 3) Lo mismo con el carnet (minúsculas, espacios, otro formato)
await rechaza(api.guardar({ datos: { nombres: 'Ana 2', carnet: ' fb 001 ' }, fotos: {}, usuario: 'u' }), 'carnet');
assert.equal(jugadores().length, 1);

// 4) Un rechazo no deja escrituras a medias: si el DUI es nuevo pero el carnet está repetido, tampoco se crea la llave del DUI
await rechaza(api.guardar({ datos: { nombres: 'Mix', dui: '12345678-4', carnet: 'FB-001' }, fotos: {}, usuario: 'u' }), 'carnet');
assert.equal(jugadores().length, 1);
assert.deepEqual(llaves(), ['documentos/carnet_FB001', 'documentos/dui_054821351']);

// 5) Actualizar al mismo jugador con los mismos números no da error (la llave ya es suya)
await api.guardar({ id: idA, datos: { nombres: 'Ana Corregida', dui: '05482135-1', carnet: 'FB-001' }, fotos: {}, usuario: 'u' });
assert.equal(datos.get(`players/${idA}`).nombres, 'Ana Corregida');
assert.equal(jugadores().length, 1);

// 6) Otro jugador con solo carnet, y luego no puede quedarse con el DUI de Ana
const idB = await crearId({ datos: { nombres: 'Beto', carnet: 'FB-777' }, fotos: {}, usuario: 'u' });
await rechaza(api.guardar({ id: idB, datos: { nombres: 'Beto', dui: '05482135-1', carnet: 'FB-777' }, fotos: {}, usuario: 'u' }), 'dui');
assert.equal(datos.get(`players/${idB}`).dui, undefined, 'el rechazo no debe modificar al jugador');

// 7) Cambiar el DUI de Ana libera el anterior y toma el nuevo
await api.guardar({ id: idA, datos: { nombres: 'Ana', dui: '12345678-4', carnet: 'FB-001' }, fotos: {}, usuario: 'u' });
assert.ok(!datos.has('documentos/dui_054821351'), 'la llave vieja se libera');
assert.ok(datos.has('documentos/dui_123456784'));
const idC = await crearId({ datos: { nombres: 'Carla', dui: '05482135-1' }, fotos: {}, usuario: 'u' }); // ahora sí se puede
assert.equal(datos.get('documentos/dui_054821351').jugadorId, idC);

// 8) Dos guardados "a la vez" del mismo documento: solo uno gana
const [r1, r2] = await Promise.allSettled([
  api.guardar({ datos: { nombres: 'Carrera 1', dui: '99999999-2' }, fotos: {}, usuario: 'u' }),
  api.guardar({ datos: { nombres: 'Carrera 2', dui: '99999999-2' }, fotos: {}, usuario: 'u' }),
]);
assert.deepEqual([r1.status, r2.status].sort(), ['fulfilled', 'rejected']);
assert.equal([...datos.entries()].filter(([k, v]) => /^players\/[^/]+$/.test(k) && v.dui === '99999999-2').length, 1);

// 9) Un jugador anterior (sin llaves) recibe sus llaves la primera vez que se actualiza
datos.set('players/legado1', { nombres: 'Luis', tipo: 'DUI', numero: '00000000-0' });
await api.guardar({ id: 'legado1', datos: { nombres: 'Luis', dui: '00000000-0' }, fotos: {}, usuario: 'u', borrarAntiguas: true });
assert.equal(datos.get('documentos/dui_000000000').jugadorId, 'legado1');

// 10) Borrar un jugador libera sus llaves, y solo las suyas
await api.eliminar(idA);
assert.ok(!datos.has(`players/${idA}`));
assert.ok(!datos.has('documentos/dui_123456784') && !datos.has('documentos/carnet_FB001'));
assert.ok(datos.has('documentos/dui_054821351'), 'la llave de Carla no se toca');
await api.guardar({ datos: { nombres: 'Nuevo Ana', dui: '12345678-4' }, fotos: {}, usuario: 'u' }); // ya se puede volver a registrar

// 11) Números incompletos no crean llaves ni bloquean
const antes = llaves().length;
await api.guardar({ datos: { nombres: 'Sin DUI completo', dui: '1234', carnet: 'ab' }, fotos: {}, usuario: 'u' });
await api.guardar({ datos: { nombres: 'Otro sin DUI completo', dui: '1234', carnet: 'ab' }, fotos: {}, usuario: 'u' });
assert.equal(llaves().length, antes);

// 12) Reglas nuevas sin publicar (documentos/ rechazado): se guarda igual, sin llaves, y se avisa
estado.sinReglasDeDocumentos = true;
const r12 = await api.guardar({ datos: { nombres: 'Sin reglas', dui: '77777777-7' }, fotos: {}, usuario: 'u' });
assert.equal(r12.sinLlaves, true);
assert.equal(datos.get(`players/${r12.id}`).nombres, 'Sin reglas');
assert.ok(!datos.has('documentos/dui_777777777'));
await api.eliminar(r12.id); // borrar también funciona
assert.ok(!datos.has(`players/${r12.id}`));
estado.sinReglasDeDocumentos = false;
assert.equal((await api.guardar({ datos: { nombres: 'Con reglas', dui: '66666666-6' }, fotos: {}, usuario: 'u' })).sinLlaves, false);

console.log('backend: todas las pruebas pasaron (12 casos)');
