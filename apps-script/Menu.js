/**
 * Menú de la planilla, preparación, tareas automáticas y respaldos.
 * El administrador corre todo desde aquí: Claude no ejecuta funciones del servidor.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Cuentas')
    .addItem('Preparar planilla (respalda primero)', 'prepararPlanilla')
    .addItem('Clasificar ahora', 'menuClasificar')
    .addItem('Respaldar ahora', 'menuRespaldar')
    .addSeparator()
    .addItem('Ver dirección de la API', 'verUrlApi')
    .addToUi();
}

/** Claves de App_Ajustes: [clave, valor por defecto, descripción]. Las nuevas se agregan solas al Preparar planilla. */
var INICIO_POR_DEFECTO = [
  ['nombreApp', 'Cuentas', 'Nombre que aparece arriba en la app'],
  ['googleClientId', '', 'ID de cliente de Google (termina en .apps.googleusercontent.com). Debe ser el mismo de web/config.js'],
  ['categorias', 'Comida, Casa(G.E.T.A), Bencina, Otros, Aportes, Tag, Seguro, No Presup.', 'Categorías del presupuesto, separadas por coma (las mismas de Presupuesto_Mensual)'],
  ['categoriasEspeciales', 'Abono, Pago tarjeta', 'Se pueden elegir pero no consumen presupuesto (ingresos y pago de la tarjeta)'],
  ['mesesEnApp', '6', 'Cuántos meses de movimientos muestra la app (lo pendiente se muestra siempre)'],
  ['inicioControl', '', 'AAAA-MM-DD. Lo anterior a esta fecha no se muestra ni se pide clasificar (sigue enseñando). Vacío = todo'],
  ['confianzaAuto', '0.95', 'Probabilidad mínima para que el modelo clasifique solo (y solo si ya demostró acertar)'],
  ['clasificaLaApp', 'Sí', 'Sí = el proceso que sube los movimientos deja de crear reglas por primera palabra: aprende la app'],
  ['respaldosAGuardar', '30', 'Cuántas copias diarias de la planilla se guardan en Drive'],
  ['tipoCambio', '', 'Pesos por dólar para sumar las compras en US$ al presupuesto. Vacío = los US$ se muestran aparte']
];

function prepararPlanilla() {
  var ss = planilla_(), ui = SpreadsheetApp.getUi();
  var problemas = Object.keys(HOJAS).map(problemaHoja_).filter(Boolean);
  if (problemas.length) {
    ui.alert('No se cambió nada', problemas.join('\n'), ui.ButtonSet.OK);
    return;
  }
  PropertiesService.getScriptProperties().setProperty('PLANILLA_ID', ss.getId());
  respaldar_('antes de preparar');

  Object.keys(HOJAS).forEach(function (clave) {
    var def = HOJAS[clave];
    asegurarColumnas_(clave);
    if (def.existente) return; // las pestañas del scraper no se reformatean
    var sh = ss.getSheetByName(def.nombre);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground(def.sistema ? '#e8eaed' : '#2f6f62').setFontColor(def.sistema ? '#3c4043' : '#ffffff');
    sh.setFrozenRows(1);
    (def.anchos || []).forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    if (def.sistema) sh.setTabColor('#9aa0a6');
  });

  // Claves de App_Ajustes: agrega solo las que faltan (no pisa lo que ya escribiste)
  textoPlano_('inicio', ['Valor']);
  var claves = leerTabla_('inicio').map(function (f) { return f['Clave']; });
  INICIO_POR_DEFECTO.filter(function (f) { return claves.indexOf(f[0]) < 0; })
    .forEach(function (f) { agregarFilas_('inicio', [{ 'Clave': f[0], 'Valor': f[1], 'Descripción': f[2] }]); });

  // El dueño de la planilla queda como primer admin
  var yo = Session.getEffectiveUser().getEmail();
  if (yo && !leerTabla_('personas').length) agregarFilas_('personas', [{ 'Nombre': 'Administrador', 'Correo': yo, 'Rol': 'admin' }]);
  validacion_('personas', 'Rol', ['admin', 'editor']);

  asegurarTareas_();
  var r = conBloqueo_(function () { return pasadaClasificador_(config_()); });
  registrar_('Planilla preparada', resumenPasada_(r));
  ss.toast('Planilla lista. ' + resumenPasada_(r), 'Cuentas', 8);
}

function resumenPasada_(r) {
  var pendientes = r.movs.filter(esPendiente).length;
  var auto = r.plan.cambios.filter(function (c) { return c.campos['Origen'] === 'Auto'; }).length;
  return auto + ' clasificados solos, ' + pendientes + ' esperan revisión.';
}

function columna_(clave, titulo) {
  var sh = hoja_(clave);
  var c = titulos_(sh).indexOf(titulo);
  return c < 0 ? null : sh.getRange(2, c + 1, Math.max(sh.getMaxRows() - 1, 1), 1);
}

function textoPlano_(clave, titulos) {
  titulos.forEach(function (t) { var r = columna_(clave, t); if (r) r.setNumberFormat('@'); });
}

function validacion_(clave, titulo, opciones) {
  var r = columna_(clave, titulo);
  if (r) r.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(opciones, true).setAllowInvalid(true).build());
}

/** Tareas automáticas. Cuenta gratuita: ~90 min/día de ejecución en total. */
function asegurarTareas_() {
  var existentes = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (existentes.indexOf('tareaHoraria') < 0) ScriptApp.newTrigger('tareaHoraria').timeBased().everyHours(1).create();
  if (existentes.indexOf('tareaDiaria') < 0) ScriptApp.newTrigger('tareaDiaria').timeBased().everyDays(1).atHour(4).create();
}

/** Cada hora: clasifica lo que subió el scraper. Los errores quedan en App_Registro. */
function tareaHoraria() {
  try {
    conBloqueo_(function () { pasadaClasificador_(config_()); });
  } catch (e) {
    registrar_('Error en tarea horaria', e.message);
  }
}

/** Cada madrugada: respaldo de la planilla. */
function tareaDiaria() {
  try {
    respaldar_('diario');
  } catch (e) {
    registrar_('Error en respaldo', e.message);
  }
}

function menuClasificar() {
  var r = conBloqueo_(function () { return pasadaClasificador_(config_()); });
  SpreadsheetApp.getActive().toast(resumenPasada_(r), 'Cuentas', 6);
}

function menuRespaldar() {
  var nombre = respaldar_('a mano');
  SpreadsheetApp.getActive().toast('Copia guardada: ' + nombre, 'Cuentas', 6);
}

/**
 * Copia la planilla completa a una carpeta de Drive y deja solo las N más recientes (las
 * anteriores van a la papelera de Drive, de donde se pueden recuperar por 30 días).
 */
function respaldar_(motivo) {
  var ss = planilla_();
  var carpeta = carpetaRespaldos_(ss);
  var nombre = ss.getName() + ' · respaldo ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  DriveApp.getFileById(ss.getId()).makeCopy(nombre, carpeta);
  var guardar = 30;
  try { guardar = Math.max(3, Math.round(numero_(config_().respaldosAGuardar)) || 30); } catch (e) { /* aún sin App_Ajustes */ }
  var archivos = [], it = carpeta.getFiles();
  while (it.hasNext()) archivos.push(it.next());
  archivos.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  archivos.slice(guardar).forEach(function (f) { f.setTrashed(true); });
  registrar_('Respaldo ' + motivo, nombre);
  return nombre;
}

function carpetaRespaldos_(ss) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CARPETA_RESPALDOS');
  if (id) {
    try {
      var c = DriveApp.getFolderById(id);
      if (!c.isTrashed()) return c;
    } catch (e) { /* se borró: se crea otra */ }
  }
  var nueva = DriveApp.createFolder('Respaldos · ' + ss.getName());
  props.setProperty('CARPETA_RESPALDOS', nueva.getId());
  return nueva;
}

function verUrlApi() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url ? 'Dirección de la API:\n\n' + url : 'Aún no hay una implementación web publicada.');
}
