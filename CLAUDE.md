# CLAUDE.md · Contexto para continuar el trabajo

App **Cuentas**: control de gastos compartido para el dueño y una segunda persona (ambas ven todo
y clasifican). Creada el 2026-10-27 con la skill `app-gratuita-google` (PWA en GitHub Pages + Apps
Script + Sheets + login Google; **sin** Firebase por ahora). El dueño escribe en español, quiere ir
**paso a paso** (un paso por vez, con el porqué) y que Claude haga todo lo que pueda hacer solo; a él
solo se le piden logins, autorizaciones y decisiones. Manual: `docs/MANUAL-ADMIN.md`. Configuración:
`docs/CONFIGURACION.md`.

Los movimientos y saldos los sube un proyecto local del dueño (no está en este repo). Contexto privado
(origen de los datos, cuentas, IDs, pendientes con detalle): **`CLAUDE.local.md`** (ignorado por git;
este repo es público).

## Reglas de trabajo acordadas
- **Costo $0** y mantenimiento cero: GitHub Pages + Apps Script + Sheets + Drive.
- **Datos financieros nunca en Git** (repo PÚBLICO). `web/dev-data.json` y `tests/` solo con datos
  inventados. Al revisar datos reales, **solo conteos** (sin glosas, nombres ni montos en el chat).
- Nunca leer ni imprimir las credenciales del proyecto que sube los datos (ver `CLAUDE.local.md`).
- Ante la duda, **Sin clasificar** (sugerir, no adivinar).
- La planilla es del dueño: **antes de escribir en una pestaña existente, mirar qué tiene**. La app
  agrega columnas solo al final de `Movimientos`, ubica los movimientos por `ID` y no inserta filas.
  Solo borra filas con la acción de admin `eliminarCopiasSigno` (verifica cada una y respalda antes).
- Cada cambio de la web: subir `VERSION` en `web/sw.js`, `VERSION_APP` en `web/app.js` **y** el `?v=`
  de `styles.css`, `config.js` y `app.js` en `web/index.html` (si no, el navegador usa la copia vieja).
- Probar con `node --test tests/*.test.js` y en modo demo (`?demo`, puerto 8766) antes de publicar;
  decir con honestidad qué no se pudo probar en Google.
- Escribir en los datos del dueño o crear algo público requiere que él lo pida explícitamente (el modo
  automático lo bloquea si no).
- Commits en español.

## Arquitectura
- `web/` → PWA vanilla JS (`app.js`, rutas `#mes` (inicio), `#bandeja`, `#movimientos`, `#mas`).
  Cambios optimistas en pantalla, enviados en cola; la última respuesta del servidor reemplaza los datos.
  Mes = "Hoy en el banco" (saldo, deuda tarjeta, disponible de verdad) + gastado real contra el
  presupuesto (misma lógica que la hoja `Resumen`: fila del mes o Default, neto de devoluciones,
  Pendientes; Pago tarjeta y Abono no son gasto).
- `apps-script/`:
  - `Clasificador.js` — funciones puras (también corren en Node). 3 capas: memoria por comercio
    (huella de la glosa, auto con 2 decisiones iguales), Reglas (incluye `Recordada`, calzan por
    huella), Naive Bayes que solo clasifica solo si su evaluación dejando-uno-fuera da ≥95 % en sus
    casos seguros con ≥30 ejemplos. Transferencias: nunca auto por memoria/modelo.
  - `Cuentas.js` — lectura de Movimientos, `pasadaClasificador_` (al abrir la app, cada hora y tras
    cada acción), acciones `clasificar`/`confirmar`/`nota`/`regla`/`eliminarCopiasSigno`, y lectura de
    `Presupuesto_Mensual`, `Pendientes` y `Saldos` (solo la última lectura de cada cuenta).
  - `Api.js` (doPost, todo con `conBloqueo_`; `diagnostico` = estructura de columnas sin datos),
    `Sesion.js` (login Google → token HMAC 180 días; solo correos de `App_Personas`), `Planilla.js`
    (HOJAS, tablas por título, `fechaHora_`), `Menu.js` (Preparar planilla, tareas, respaldo diario).
- Pestañas de la app: `App_Ajustes` (incluye `inicioControl`, `tipoCambio`, `clasificaLaApp`),
  `App_Personas`, `App_Registro`. Columnas de la app en `Movimientos`: `Sugerencia`, `Confianza`,
  `Clasificado_Por`, `Fecha_Clasif`, `Mes_Presupuesto` (esta última se agrega sola la primera vez que
  alguien mueve un gasto de mes; se escribe con apóstrofo para que Sheets no la convierta en fecha y se
  lee con `mesDeCelda_`). Pestañas que llena el proceso local: `Movimientos`, `Reglas`, `Saldos`.
- IDs y cuentas: en `CLAUDE.local.md`. URL: `https://aidevfelipe-commits.github.io/app-cuentas/`.

## Publicar
```bash
node --test tests/*.test.js; for f in apps-script/*.js; do node --check $f; done; node --check web/app.js
clasp --user cuentas push -f && clasp --user cuentas update-deployment <DEPLOYMENT_ID> -d "descripción"
git add -A && git commit -m "…" && git push      # publica la web (GitHub Actions)
```
Tras `update-deployment`, la API tarda ~15 s en servir el código nuevo.

## Estado actual (2026-11-01)
- **En producción y en uso por las dos personas** (app instalada en los teléfonos). Web v9, API
  versión 14 (mismo deployment de siempre). 37 pruebas en Node.
- v8 (2026-11-01): clasificar en dos pasos (tocar la categoría solo la marca, se guarda con el botón
  "Guardar en …"; la sugerencia viene marcada) porque con un toque había muchos errores. "Lo último que
  clasificaron" va antes que las automáticas, que quedan plegadas (había 61 y tapaban la sección).
  Arreglado: la nota y "Recordar destinatario" de la bandeja no se enviaban (`closest('[data-ids]')`
  devolvía el propio botón).
- v9 (2026-11-01): **mes del presupuesto**. Cada movimiento cuenta en el mes de su fecha salvo que
  lo muevan ("Cuenta para el presupuesto de: Octubre | Noviembre" al clasificar; a la vista en la
  bandeja los días 1–5 y 25–31 o si ya se movió; en el editor, siempre; máx. ±2 meses). Mes,
  Movimientos y sus totales usan `mesPres(m)`; lo movido se ve en ambos meses (atenuado donde no
  cuenta) y la pantalla Mes dice cuánto entró y salió. Acción `clasificar` con `mes` opcional.
- Hecho: bandeja con agrupación por comercio, revisión de automáticas, "Lo último que
  clasificaron" para corregir, movimientos con filtros y notas, deshacer, pantalla Mes con presupuesto
  y saldos del banco, reglas fijas desde la app, `inicioControl = 2026-10-01` (septiembre no se pide
  clasificar), respaldo diario, reglas `pago de tarjeta` y `monto cancelado` → Pago tarjeta.

## Lo aprendido (no repetir)
- `Movimientos` tiene formatos de celda antiguos mezclados: `Fecha_Clasif` se escribe como texto
  `AAAA-MM-DD HH:mm:ss` y se lee con `fechaHora_` (acepta Date, texto ISO y texto largo de JS);
  `Confianza` se escribe como `"87%"`. Cambiar el formato de la columna no bastó.
- El navegador guarda `app.js` viejo aunque cambie `VERSION`: por eso el `?v=` en `index.html`.
- La app mostraba "Cargando…" para siempre si una pantalla fallaba al usar la copia local: `render`
  ahora atrapa errores y `elegirMes()` corre también con la copia guardada.
- Para revisar datos reales sin verlos: en el panel del navegador (localhost:8766, con la sesión del
  dueño en localStorage) llamar a la API y devolver solo conteos.
- El servidor local de vista previa se apaga solo cada tanto: volver a levantarlo (`preview_start`).
- El token de `gh` necesita el permiso `workflow` para subir `.github/workflows/`.

## Pendientes
Camino acordado el 2026-11-01 para "dejar todo cuadrado" (disponible, deuda y presupuesto por ítem):
(a) ✅ guardar con botón y "Lo último" visible (v8); (b) ✅ mes del presupuesto (v9); (c) el dueño
cierra octubre en la app; (d) corrida del 2-nov (abajo); (e) dólares: 63 compras US$ de la tarjeta en
octubre (60 en No Presup.), `tipoCambio = 0`: decidir conversión, revisar duplicados y sumar la deuda
US$ al "disponible de verdad"; (f) presupuesto de noviembre + compromisos fijos → arriba de Mes:
Tengo / Debo / Por pagar / Me queda del presupuesto / Libre de verdad.

1. **Revisar la corrida automática del 2026-11-02** (detalles en `CLAUDE.local.md`): que la tarjeta
   traiga sus 4 conceptos con la etiqueta correcta y arreglar en el proceso local cómo se lee el signo
   de la cartola de octubre (hoy no cuadra y se descarta entera).
2. Fase 3: compromisos fijos (hoja `Pendientes`), subcategorías para dividir "Otros", dividir un movimiento.
3. Fase 4: avisos push, evolución mes a mes, revisar/borrar reglas sobre-ajustadas, `tipoCambio`
   (hoy casi todas las compras en US$ están en "No Presup.").
4. Rendimiento: cada llamada a la API tarda ~3,5 s (lee toda la planilla y reentrena); aceptable por ahora.

## Decisiones y detalles a recordar
- Segunda persona: rol `editor`, ve todas las cuentas y clasifica.
- Pantalla de consentimiento de Google en modo **Prueba** a propósito (solo entran los usuarios de prueba).
- Lo que no debe quedar público (banco, cuentas de GitHub/Google, rutas locales) va en `CLAUDE.local.md`.
