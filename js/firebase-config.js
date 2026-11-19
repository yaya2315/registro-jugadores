// Pega aquí la configuración de tu app web de Firebase:
// Consola de Firebase > Configuración del proyecto > Tus apps > Configuración del SDK.
//
// Estos valores NO son secretos (Firebase los expone en cualquier app web).
// La seguridad real está en firestore.rules + la lista de usuarios permitidos.

export const firebaseConfig = {
  apiKey: 'PEGAR_AQUI',
  authDomain: 'PEGAR_AQUI',
  projectId: 'PEGAR_AQUI',
  storageBucket: 'PEGAR_AQUI',
  messagingSenderId: 'PEGAR_AQUI',
  appId: 'PEGAR_AQUI',
};

export const CONFIGURADO = !Object.values(firebaseConfig).some((v) => String(v).startsWith('PEGAR'));
