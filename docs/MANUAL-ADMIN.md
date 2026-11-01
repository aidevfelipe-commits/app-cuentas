# Manual de Cuentas

## Qué hace la app

- **Bandeja**: lo que falta clasificar. Elige la categoría y toca **Guardar** (tocar una categoría
  solo la marca; la que tiene ✓ es la sugerencia y viene marcada). Los movimientos del mismo comercio
  vienen juntos ("Guardar 3 en …" o "por separado"). Debajo está **Lo último que clasificaron**: toca
  uno para corregirlo. Al final, plegados, los que se **clasificaron solos**: ábrelos, revísalos y
  marca "Están bien" (eso también enseña). Si te equivocas, el aviso de abajo tiene **Deshacer**.
- **Mes del presupuesto**: cada gasto cuenta en el mes de su fecha. Si uno es de otro mes (el súper
  del 30 que es del presupuesto siguiente), elige **"Cuenta para el presupuesto de: Noviembre"** antes
  de Guardar. En la bandeja aparece en los primeros y últimos días del mes; en cualquier movimiento,
  al tocarlo. Lo movido se ve en los dos meses (atenuado en el que no cuenta, con "↪ cuenta en …") y
  la pantalla Mes dice cuánto entró o salió. Queda en la columna `Mes_Presupuesto` (vacía = mes de
  la fecha).
- **Movimientos**: el mes, con filtros por categoría, cuenta y texto. Toca un movimiento para
  cambiar su categoría (elige y toca Guardar) o escribir una nota.
- **Más**: cómo va el aprendizaje, enlace a la planilla (solo admin) y salir.

## Cómo aprende

1. **Mismo comercio**: si ya clasificaron 2 veces igual un comercio, el siguiente se clasifica solo.
2. **Reglas** de la pestaña `Reglas` (las de antes, más las "Recordada").
3. **Modelo**: aprende de todo lo confirmado. Solo clasifica solo cuando ya demostró acertar al
   menos 95 % con sus propios datos (30+ ejemplos); mientras tanto, solo sugiere. El porcentaje se ve en Más.

Las **transferencias a personas** nunca se clasifican solas por parecido: marca "Recordar este
destinatario" cuando clasifiques una y las siguientes al mismo destinatario se clasificarán solas.

La app clasifica lo nuevo al abrirse y cada hora. Lo que clasifiques directo en la planilla
(desplegable de Categoria) también cuenta: queda como Manual con "Planilla" en `Clasificado_Por`.

## En la planilla (menú Cuentas)

- **Preparar planilla**: primero guarda un respaldo; crea `App_Ajustes`, `App_Personas` y
  `App_Registro`, agrega al final de `Movimientos` las columnas `Sugerencia`, `Confianza`,
  `Clasificado_Por` y `Fecha_Clasif`, y activa las tareas automáticas. Se puede repetir sin riesgo.
- **Clasificar ahora**: lo mismo que hace la tarea de cada hora.
- **Respaldar ahora**: copia completa en la carpeta de Drive "Respaldos · Control de Gastos" (se
  guardan las últimas 30; hay una automática cada madrugada).

## Quién entra

Pestaña `App_Personas`: Nombre, Correo (cuenta de Google), Rol. `admin` ve además el enlace a la
planilla; `editor` ve y clasifica todo igual. Para quitar el acceso, borra la fila.

## Ajustes (`App_Ajustes`)

| Clave | Para qué |
|---|---|
| `categorias` | Categorías del presupuesto, separadas por coma |
| `categoriasEspeciales` | Se eligen pero no consumen presupuesto (Abono, Pago tarjeta) |
| `mesesEnApp` | Meses que muestra la app (lo pendiente se ve siempre) |
| `inicioControl` | Fecha (AAAA-MM-DD) desde la que se lleva el control: lo anterior no se muestra ni se pide clasificar |
| `confianzaAuto` | Probabilidad mínima para que el modelo clasifique solo |
| `clasificaLaApp` | `Sí`: el scraper deja de crear reglas por primera palabra (aprende la app) |
| `respaldosAGuardar` | Copias diarias que se guardan |
| `googleClientId` | ID de cliente de Google (igual al de `web/config.js`) |

## Cuando algo falla

Mira `App_Registro` (errores del servidor, accesos rechazados, respaldos). Si la app no muestra lo
último: botón ↻ arriba a la derecha, o cerrar y abrir la app y ver la versión en Más.
