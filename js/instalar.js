// Instalación de la app en el teléfono (PWA).
// Android/Chrome: botón que abre el aviso de instalación del sistema.
// iPhone/Safari: no existe ese aviso, así que se muestran los pasos.

const $ = (s) => document.querySelector(s);

const yaInstalada = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const esIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad con "sitio de escritorio"

let promptDiferido = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker:', e));
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptDiferido = e;
  mostrar();
});

window.addEventListener('appinstalled', () => {
  promptDiferido = null;
  ocultar();
});

function ocultar() {
  $('#instalar').hidden = true;
  $('#btn-instalar-barra').hidden = true;
}

function mostrar() {
  if (yaInstalada()) return;
  $('#instalar').hidden = false;
  $('#btn-instalar-barra').hidden = false;
}

function pasos() {
  if (esIOS()) {
    return 'En Safari: pulsa el botón Compartir (el cuadro con la flecha hacia arriba) y elige «Agregar a pantalla de inicio».';
  }
  return 'En el menú del navegador (los tres puntos ⋮) elige «Instalar aplicación» o «Agregar a pantalla de inicio».';
}

async function instalar() {
  const ayuda = $('#instalar-ayuda');
  if (promptDiferido) {
    promptDiferido.prompt();
    const { outcome } = await promptDiferido.userChoice;
    promptDiferido = null;
    if (outcome === 'accepted') ocultar();
    return;
  }
  ayuda.textContent = pasos();
  ayuda.hidden = false;
}

$('#btn-instalar').addEventListener('click', instalar);
$('#btn-instalar-barra').addEventListener('click', instalar);

// Botón visible desde el principio (en iPhone nunca llega el evento del sistema).
mostrar();
