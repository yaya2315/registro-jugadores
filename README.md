# Registro de jugadores

Aplicación web para registrar jugadores tomando fotos de su **DUI** o **carnet de fútbol**. La app lee el texto de la foto (OCR), rellena el formulario, y al guardar los datos y las fotos quedan en **Firebase (Firestore)**. Solo pueden entrar las cuentas que el administrador autorice.

- Inicio de sesión: Google (Firebase Authentication)
- Base de datos: Cloud Firestore
- Lectura de fotos: Tesseract.js, se ejecuta en el propio navegador (la foto no se envía a ningún servicio de OCR)
- Hosting: GitHub Pages (sitio estático, sin compilación)

## Cómo funciona

1. La persona autorizada inicia sesión con Google.
2. Pulsa **Nuevo registro**, elige DUI o Carnet y toma foto del frente y reverso (o la sube de la galería).
3. La app rellena número, nombres, apellidos y fecha de nacimiento. **Siempre hay que revisar los datos**: el OCR puede equivocarse. En el DUI se valida además el dígito verificador.
4. Al guardar, el registro aparece en la lista, con búsqueda, filtro por tipo y exportación a CSV (Excel).

Las fotos se reducen y comprimen (JPEG) y se guardan en Firestore, así no hace falta Firebase Storage (que exige plan de pago).

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

### 4. Autorizar a los usuarios
En **Firestore Database > Datos**:
1. **Iniciar colección** con ID `allowed`.
2. Como **ID del documento**, escribe el correo de Gmail del cliente **en minúsculas** (ej. `cliente@gmail.com`). Agrega un campo cualquiera (ej. `nombre` = `Cliente`).
3. Repite para cada persona que deba tener acceso.

Para quitar el acceso a alguien, borra su documento de `allowed`.
Quien no esté en esa lista no puede leer ni escribir nada, aunque entre con Google.

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
allowed/{correo}                      -> lista de correos autorizados (solo desde la consola)
players/{id}                          -> tipo, numero, nombres, apellidos, fechaNacimiento,
                                         equipo, telefono, notas, miniatura, creadoEn, creadoPor
players/{id}/fotos/{frente|reverso}   -> { data: "data:image/jpeg;base64,..." }
```

## Privacidad

El DUI es un dato personal sensible. Recomendaciones:
- Autoriza solo a quien lo necesite y revisa la colección `allowed` de vez en cuando.
- Descarga (CSV) y comparte los datos con cuidado.
- Los datos de Firestore están cifrados por Google en tránsito y en reposo.
