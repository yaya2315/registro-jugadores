// Pega aquí la configuración de tu app web de Firebase:
// Consola de Firebase > Configuración del proyecto > Tus apps > Configuración del SDK.
//
// Estos valores NO son secretos (Firebase los expone en cualquier app web).
// La seguridad real está en firestore.rules + la lista de usuarios permitidos.

export const firebaseConfig = {
  apiKey: 'AIzaSyC-o64XaYlZ4P2ChafLTJspHYdlbEJhRQI',
  authDomain: 'registro-jugadores-75efb.firebaseapp.com',
  projectId: 'registro-jugadores-75efb',
  storageBucket: 'registro-jugadores-75efb.firebasestorage.app',
  messagingSenderId: '578503501807',
  appId: '1:578503501807:web:a2bd3475602781c036b81a',
};

export const CONFIGURADO = !Object.values(firebaseConfig).some((v) => String(v).startsWith('PEGAR'));
