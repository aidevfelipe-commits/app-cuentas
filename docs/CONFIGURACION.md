# Configuración inicial (una sola vez)

Los pasos con 👤 los haces tú en el navegador; el resto lo hace Claude desde la terminal. Todo se
hace con **la cuenta de Google dueña de la planilla "Control de Gastos"**. Anotar cada ID en `CLAUDE.md` a medida que aparece.

## 1. Script ligado a la planilla

1. 👤 Abrir la planilla "Control de Gastos" ▸ **Extensiones ▸ Apps Script**. Se abre un proyecto
   nuevo: ponerle de nombre **Cuentas**. Luego ⚙ **Configuración del proyecto** ▸ copiar el
   **ID de secuencia de comandos** (script ID) y pasárselo a Claude.
2. 👤 Activar la API de Apps Script: https://script.google.com/home/usersettings ▸ Activada.
3. 👤 Dar acceso a clasp con la cuenta dueña de la planilla, con nombre propio para no pisar otras
   cuentas ya conectadas:
   ```bash
   clasp login --user cuentas
   ```
4. Claude crea `.clasp.json` con el script ID y sube el código: `clasp --user cuentas push -f`.
5. 👤 Recargar la planilla ▸ menú **Cuentas ▸ Preparar planilla**. Google pide autorizar
   ("Configuración avanzada ▸ Ir a Cuentas (no seguro)" es normal en scripts propios). Hace, en orden:
   respaldo en Drive, pestañas `App_*`, 4 columnas nuevas **al final** de `Movimientos` (no mueve
   ninguna otra, así que el dashboard y las fórmulas siguen igual), tareas automáticas y una primera
   clasificación. Al terminar muestra cuántos se clasificaron solos.
6. 👤 En `App_Personas`: en tu fila cambia "Administrador" por tu nombre (es lo que se anota en
   `Clasificado_Por`) y agrega a la otra persona: Nombre, su Gmail, rol `editor`.

## 2. Inicio de sesión con Google

1. 👤 https://console.cloud.google.com ▸ un proyecto (se usó el mismo de la Service Account).
2. 👤 Google Auth Platform ▸ **Comenzar**: nombre "Cuentas", correo de asistencia, público **Externo**.
   Se deja en modo **Prueba** a propósito y se agregan las dos cuentas en **Audiencia ▸ Usuarios de
   prueba**: así solo ellas pueden iniciar sesión, y no hace falta página principal ni de privacidad
   (que Google exige para publicarla). Quien no esté en la lista ve "Acceso bloqueado".
3. 👤 **Clientes ▸ Crear cliente ▸ Aplicación web**. Orígenes autorizados:
   `https://<usuario-github>.github.io` y `http://localhost:8766`. Copiar el ID (termina en
   `.apps.googleusercontent.com`) en la planilla, `App_Ajustes ▸ googleClientId`, y pasárselo a Claude
   para `web/config.js`.

## 3. Publicar la API

```bash
clasp --user cuentas push -f && clasp --user cuentas deploy -d "API"
```
Anotar el ID del deployment (`AKfy…`): es para siempre (`clasp --user cuentas update-deployment <ID>`;
nunca otro `clasp deploy`). La URL `https://script.google.com/macros/s/<ID>/exec` va en `web/config.js ▸ apiUrl`.
Comprobar `<URL>?accion=ping` → `{"ok":true,…}`.

## 4. GitHub Pages

1. 👤 Decidir con qué cuenta de GitHub publicar (ver `CLAUDE.local.md`). Crear ahí un repositorio
   **público** `app-cuentas`.
2. 👤 `gh repo create <cuenta>/app-cuentas --public --source . --remote origin --push` (crear algo
   público lo aprueba el dueño). Si GitHub rechaza `.github/workflows/`, falta el permiso:
   `gh auth refresh -h github.com -s workflow`.
3. Activar Pages con Actions: `gh api -X POST repos/<cuenta>/app-cuentas/pages -f build_type=workflow`.
4. Si la URL final cambió, actualizar los orígenes del cliente OAuth (paso 2.3) y la página principal.

## 5. Primera prueba real

1. 👤 Abrir la URL en el teléfono, entrar con Google, instalar (Android: "Instalar"; iPhone:
   Compartir ▸ Agregar a inicio).
2. 👤 La otra persona hace lo mismo con su Gmail.
3. 👤 Clasificar algunos movimientos y mirar en la planilla que aparezcan `Manual` y su nombre en
   `Clasificado_Por`. Si algo falla, mirar `App_Registro`.
