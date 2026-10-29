# CLAUDE.md · Contexto para continuar el trabajo

App **Cuentas**: control de gastos compartido para él y una segunda persona (ambas ven todo
y clasifican). Creada el 2026-10-27 con la skill `app-gratuita-google` (PWA en GitHub Pages + Apps
Script + Sheets + login Google; **sin** Firebase por ahora). El dueño escribe en español y espera
respuestas claras, sin jerga técnica. Manual: `docs/MANUAL-ADMIN.md`. Configuración: `docs/CONFIGURACION.md`.

Los movimientos los sube un proyecto local del dueño (no está en este repo). Contexto privado
(origen de los datos, cuentas, IDs): **`CLAUDE.local.md`** (ignorado por git; este repo es público).

## Reglas de trabajo acordadas
- **Costo $0** y mantenimiento cero: GitHub Pages + Apps Script + Sheets + Drive.
- **Datos financieros nunca en Git** (repo PÚBLICO). `web/dev-data.json` y `tests/` solo con datos
  inventados; ignorados `originales/`, `tools/out/`, `web/dev-real*.json`. Al revisar datos reales,
  mostrar solo conteos. No volcar glosas ni nombres de contrapartes al disco ni al chat.
- Nunca leer ni imprimir las credenciales del proyecto que sube los datos (ver `CLAUDE.local.md`).
- Ante la duda, **Sin clasificar** (sugerir, no adivinar).
- La planilla es del dueño: **antes de escribir en una pestaña existente, mirar qué tiene**. La app
  solo agrega columnas al final de `Movimientos`, nunca inserta ni borra filas (el scraper ubica sus
  filas por posición) y ubica los movimientos por `ID`.
- Cada cambio de la web: subir `VERSION` en `web/sw.js`, `VERSION_APP` en `web/app.js` **y** el `?v=` de `styles.css`, `config.js` y `app.js` en `web/index.html` (si no, el navegador usa la copia vieja).
- Probar con `node --test tests/*.test.js` y en modo demo (`?demo`, puerto 8766: el 8765 lo usa
  otra app local) antes de publicar; decir con honestidad qué no se pudo probar en Google.
- No ejecutar funciones del servidor desde aquí: el dueño las corre desde el menú **Cuentas**.
- Commits en español.

## Arquitectura
- `web/` → PWA vanilla JS (`app.js`, rutas `#bandeja`, `#movimientos`, `#mas`). Cambios optimistas
  en pantalla, enviados en cola; la última respuesta del servidor reemplaza los datos.
- `apps-script/`:
  - `Clasificador.js` — funciones puras (también corren en Node). 3 capas: memoria por comercio
    (huella de la glosa, auto con 2 decisiones iguales), Reglas (igual que el motor del proyecto que sube los datos; las
    `Recordada` calzan por huella), Naive Bayes que solo clasifica solo si su evaluación dejando-uno-
    fuera da ≥95 % en sus casos seguros con ≥30 ejemplos. Transferencias: nunca auto por memoria/modelo.
  - `Cuentas.js` — lectura de Movimientos, `pasadaClasificador_` (al abrir la app, cada hora y tras
    cada acción), acciones `clasificar`/`confirmar`/`nota`.
  - `Api.js` (doPost, todo con `conBloqueo_`), `Sesion.js` (login Google → token HMAC 180 días;
    acceso solo a correos de `App_Personas`), `Planilla.js` (HOJAS, tablas por título), `Menu.js`
    (Preparar planilla, tareas, respaldo diario en Drive con las últimas 30 copias).
- Pestañas de la app: `App_Ajustes`, `App_Personas`, `App_Registro` (prefijo para no chocar con las de
  dueño). Columnas nuevas en `Movimientos`: `Sugerencia`, `Confianza`, `Clasificado_Por`, `Fecha_Clasif`.
- Convivencia con el scraper: con `App_Ajustes ▸ clasificaLaApp = Sí`, su pipeline diario deja de crear
  reglas por primera palabra (sigue aplicando las Reglas al subir). Origen sigue siendo solo
  `Auto`/`Manual`/`Sin clasificar`; si había un apunte en Origen, al clasificar pasa a `Nota`.
- IDs (completar al configurar): script `…`, deployment API `…` (fijo, nunca crear otro), proyecto GCP
  `…`, cliente OAuth `…` (detalle en `CLAUDE.local.md`), URL `https://aidevfelipe-commits.github.io/app-cuentas/`.

## Publicar
```bash
node --test tests/*.test.js; for f in apps-script/*.js; do node --check $f; done; node --check web/app.js
clasp --user cuentas push -f && clasp --user cuentas update-deployment <DEPLOYMENT_ID> -d "descripción"
git add -A && git commit -m "…" && git push      # publica la web
```

## Estado actual (2026-10-27)
- **Fase 1 construida, sin configurar en Google todavía**: bandeja con un toque y agrupación por
  comercio, revisión de automáticas, movimientos del mes con filtros y notas, deshacer, clasificador
  de 3 capas, respaldo diario. Probado: 26 pruebas en Node (clasificador + servidor contra planilla
  simulada) y la web en modo demo (móvil, claro y oscuro). **No probado**: nada en Apps Script real
  (permisos, Drive, tiempos, login).
- Siguiente: configuración (`docs/CONFIGURACION.md`), luego Fase 2 = pantalla del mes con
  presupuesto/gastado/pendiente/remanente en código (hoy son fórmulas en `Resumen`); Fase 3 =
  compromisos fijos (hoja `Pendientes`), subcategorías (dividir "Otros"), dividir un movimiento;
  Fase 4 = avisos push, evolución mensual, revisar/borrar reglas sobre-ajustadas.

## Decisiones y detalles a recordar
- Segunda persona: rol `editor`, puede ver todas las cuentas y clasificar.
- Lo que no debe quedar público (banco, cuentas de GitHub/Google, rutas locales) va en `CLAUDE.local.md`.
