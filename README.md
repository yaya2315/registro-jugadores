# Registro de jugadores

Aplicación web (instalable en el celular) para registrar jugadores tomando fotos de su **DUI** o **carnet de fútbol**. La app lee el texto de la foto (OCR), extrae la foto del rostro del documento, rellena la ficha, y al guardar todo queda en **Firebase (Firestore)**. Solo pueden entrar las cuentas que el administrador autorice.

- Inicio de sesión: Google (Firebase Authentication)
- Base de datos: Cloud Firestore
- Lectura de fotos: Tesseract.js, y detección de rostro con MediaPipe. Ambos se ejecutan en el propio navegador: las fotos no se envían a ningún servicio de OCR
- Hosting: GitHub Pages (sitio estático, sin compilación)

## Cómo funciona

1. La persona autorizada inicia sesión con Google.
2. Pulsa **Nuevo jugador** y toma foto del frente y reverso del **DUI** y/o del **carnet** (o las sube de la galería). Un mismo jugador puede tener los dos documentos.
3. La app rellena número de documento, nombres, apellidos y fecha de nacimiento, y **recorta la cara del jugador** de la foto del documento: solo la cabeza, sin fondo y con un retoque mínimo, que se ve sobre un degradado verde en el plantel. Si ya hay fotos de documento en el formulario, el botón «Sacar del documento» repite el recorte. **Siempre hay que revisar los datos**: el OCR puede equivocarse. En el DUI se valida además el dígito verificador. Si la foto del rostro no sale bien, se puede tomar o subir otra.
4. Al guardar, el jugador aparece en el **Plantel**: una fila por jugador con su foto a la izquierda y su nombre, equipo, edad y posición a la derecha, más marcas de qué documentos ya tiene registrados.
5. Desde el plantel: búsqueda (sin importar tildes), filtros (con DUI, con carnet, falta documento, por equipo), orden, ficha completa con fotos ampliables, edición, borrado y exportación a Excel.
6. **Imprimir planilla:** una hoja horizontal por equipo (o de todos) con foto, nombre, DUI, carnet, nacimiento, posición, camiseta y columna de firma. En el diálogo de impresión se elige «Guardar como PDF». La **ficha** de cada jugador también se imprime, con las fotos de sus documentos.
7. **Administrar** (solo administradores): agregar o quitar usuarios, hacer a otros administradores y descargar el **respaldo completo**: un ZIP con una carpeta por jugador (su cara y las fotos de sus documentos como archivos), una tabla para Excel (`jugadores.csv`) y todos los datos (`respaldo.json`). Contiene DUI y fotos: hay que guardarlo con cuidado. Por ahora la app no tiene botón para restaurarlo.

Las fotos de los documentos se reducen y comprimen (JPEG) y se guardan en Firestore, así no hace falta Firebase Storage (que exige plan de pago).

## Puesta en marcha (una sola vez)

### 1. Crear el proyecto de Firebase
1. Entra a <https://console.firebase.google.com> y crea un proyecto (puedes desactivar Google Analytics).
2. **Compilación > Firestore Database > Crear base de datos**. Elige una región cercana (por ejemplo `us-east1`) y modo **producción**.
3. **Compilación > Authentication > Comenzar > Google > Habilitar**. Pon un correo de soporte y guarda.
4. **Authentication > Configuración > Dominios autorizados > Agregar dominio**: `yaya2315.github.io`.
5. **Configuración del proyecto (engrane) > Tus apps > Web (`</>`)**: registra una app y copia el objeto `firebaseConfig`.

### 2. Pegar la configuración
Abre `js/firebase-config.js`, reemplaza los `PEGAR_AQUI` por tus valores y súbelo a GitHub. (Estos valores no son secretos; lo que protege los datos son las reglas del paso siguiente.)

### 3. Publicar las reglas de seguridad
En **Firestore Database > Reglas**, pega el contenido de `firestore.rules` y pulsa **Publicar**.
(Con Firebase CLI: `firebase deploy --only firestore:rules`.)

### 4. Crear el primer administrador
Hay dos niveles de acceso: **usuario** (ve y edita jugadores) y **administrador** (además maneja usuarios y respaldos).
Solo el primer administrador se crea desde la consola; después se manejan desde la app.

En **Firestore Database > Datos**:
1. Si no existe, **Iniciar colección** con ID `allowed`.
2. Abre (o crea) el documento cuyo **ID es tu correo de Gmail en minúsculas** (ej. `cliente@gmail.com`).
3. **Agregar campo**: nombre `admin`, tipo **boolean**, valor **true**.

Desde ese momento, al entrar a la app aparece el botón **Administrar** (arriba), donde se agregan o quitan usuarios, se hacen otros administradores y se descarga el respaldo.
Un administrador no puede quitarse a sí mismo el acceso ni el rol, así que siempre queda al menos uno.
Quien no esté en la lista no puede leer ni escribir nada, aunque entre con Google.

> Si ya habías publicado las reglas anteriores, vuelve a pegar `firestore.rules` y publícalas: las reglas nuevas son las que validan los roles.

### 5. Publicar en GitHub Pages
En el repositorio: **Settings > Pages > Build and deployment > Source: Deploy from a branch > Branch: `main` / `/ (root)` > Save**.
Al cabo de un minuto la app queda en <https://yaya2315.github.io/registro-jugadores/>.

## Probar en tu computadora
```
npx serve .
```
y abre `http://localhost:3000` (agrega también `localhost` en los dominios autorizados de Firebase si no aparece; normalmente ya viene).

Pruebas del lector de datos:
```
node test/parser.test.mjs
```

## Estructura de datos

```
allowed/{correo}                 -> usuarios autorizados: nombre, admin (true/false), agregadoPor, agregadoEn
                                    (solo los administradores pueden cambiarla)
players/{id}                     -> nombres, apellidos, fechaNacimiento, equipo, posicion, camiseta,
                                    telefono, notas, dui, carnet, foto (retrato 3:4),
                                    creadoEn, creadoPor
players/{id}/fotos/{clave}       -> { data: "data:image/jpeg;base64,..." }
                                    clave: dui_frente | dui_reverso | carnet_frente | carnet_reverso
```

Los registros guardados con la primera versión (un documento por registro, campos `tipo` y `numero`) se siguen leyendo y se convierten al formato nuevo la primera vez que se editan.

## Modo demostración (solo en tu computadora)

Con `npx serve .` abre `http://localhost:3000/?demo`. Usa datos de ejemplo en memoria, sin iniciar sesión y sin tocar Firebase, útil para probar la interfaz. Solo funciona en `localhost`; en la página publicada se ignora.

## Privacidad

El DUI es un dato personal sensible. Recomendaciones:
- Autoriza solo a quien lo necesite y revisa la colección `allowed` de vez en cuando.
- Descarga (CSV) y comparte los datos con cuidado.
- Los datos de Firestore están cifrados por Google en tránsito y en reposo.
