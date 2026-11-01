/**
 * Estructura de la planilla "Control de Gastos" y utilidades para leerla/escribirla como tablas.
 * La primera fila de cada pestaña son los títulos; el código usa esos títulos, no las columnas,
 * así que se pueden reordenar o insertar columnas sin romper nada.
 *
 * Pestañas de la app (prefijo App_ para no chocar con las tuyas): se crean al "Preparar planilla".
 * Pestañas existentes (existente: true) las crea y llena el proceso que sube los movimientos:
 * la app nunca las crea ni les cambia formato; solo agrega al final sus columnas (`titulos`).
 * sistema: true = la llena la app (pestaña gris), no se edita a mano.
 */

var HOJAS = {
  inicio: {
    nombre: 'App_Ajustes',
    titulos: ['Clave', 'Valor', 'Descripción'],
    anchos: [180, 420, 420]
  },
  personas: {
    nombre: 'App_Personas',
    titulos: ['Nombre', 'Correo', 'Rol', 'Notas'],
    anchos: [180, 260, 100, 300]
  },
  registro: {
    nombre: 'App_Registro',
    titulos: ['Fecha', 'Evento', 'Detalle'],
    anchos: [150, 200, 600],
    sistema: true
  },
  movimientos: {
    nombre: 'Movimientos',
    existente: true,
    obligatorios: ['ID', 'Fecha', 'Glosa', 'Monto', 'Cuenta', 'Categoria', 'Origen'],
    titulos: ['Sugerencia', 'Confianza', 'Clasificado_Por', 'Fecha_Clasif']
  },
  reglas: {
    nombre: 'Reglas',
    existente: true,
    obligatorios: ['Palabra_Clave', 'Categoria', 'Origen'],
    titulos: []
  },
  presupuesto: {
    nombre: 'Presupuesto_Mensual',
    existente: true,
    opcional: true,
    obligatorios: ['Categoria', 'Mes', 'Monto_Presupuestado'],
    titulos: []
  },
  saldos: {
    nombre: 'Saldos',
    existente: true,
    opcional: true,
    obligatorios: ['Fecha', 'Cuenta', 'Concepto', 'Monto'],
    titulos: []
  },
  pendientes: {
    nombre: 'Pendientes',
    existente: true,
    opcional: true,
    obligatorios: ['Categoria', 'Monto_Estimado', 'Fecha_Estimada', 'Estado'],
    titulos: []
  }
};

function planilla_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PLANILLA_ID'));
}

function hoja_(clave) {
  var def = HOJAS[clave];
  var sh = planilla_().getSheetByName(def.nombre);
  if (!sh) throw new Error('Falta la pestaña "' + def.nombre + '". Usa el menú ▸ Preparar planilla.');
  return sh;
}

function titulos_(sh) {
  return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function (t) { return String(t).trim(); });
}

/**
 * Por qué esta pestaña no sirve tal como está, o '' si está bien (o aún no existe y se puede crear).
 * Evita escribir encima de una pestaña tuya que se llame igual.
 */
function problemaHoja_(clave) {
  var def = HOJAS[clave];
  var sh = planilla_().getSheetByName(def.nombre);
  if (!sh) return def.existente && !def.opcional ? 'Falta la pestaña "' + def.nombre + '" (la crea el proceso que sube los movimientos).' : '';
  if (sh.getLastRow() === 0) return def.existente && !def.opcional ? 'La pestaña "' + def.nombre + '" está vacía.' : '';
  var actuales = titulos_(sh);
  if (def.existente) {
    var faltan = def.obligatorios.filter(function (t) { return actuales.indexOf(t) < 0; });
    return faltan.length ? 'A la pestaña "' + def.nombre + '" le faltan las columnas: ' + faltan.join(', ') + '.' : '';
  }
  return actuales[0] === def.titulos[0] ? '' : 'Ya existe una pestaña "' + def.nombre + '" que no es de la app. Cámbiale el nombre y vuelve a intentar.';
}

/** Lee una pestaña como lista de objetos { titulo: valor, _fila: n }. */
function leerTabla_(clave, opciones) {
  if (opciones && opciones.opcional && !planilla_().getSheetByName(HOJAS[clave].nombre)) return [];
  var sh = hoja_(clave);
  var valores = sh.getDataRange().getValues();
  var titulos = (valores.shift() || []).map(function (t) { return String(t).trim(); });
  var filas = [];
  valores.forEach(function (fila, i) {
    // Fila vacía: sin valores, o solo casillas desmarcadas (las casillas ponen FALSE en filas sin datos)
    if (fila.every(function (v) { return v === '' || v === null || v === false; })) return;
    var o = { _fila: i + 2 };
    titulos.forEach(function (t, c) {
      if (t) o[t] = fila[c];
    });
    filas.push(o);
  });
  return filas;
}

/** Escribe objetos al final de la tabla respetando el orden de los títulos. */
function agregarFilas_(clave, objetos) {
  if (!objetos.length) return;
  var sh = hoja_(clave);
  var titulos = titulos_(sh);
  var filas = objetos.map(function (o) { return titulos.map(function (t) { return o[t] === undefined ? '' : o[t]; }); });
  sh.getRange(sh.getLastRow() + 1, 1, filas.length, titulos.length).setValues(filas);
}

/** Escribe { titulo: valor } en filas ya ubicadas: [{ fila, campos }]. Los títulos que no existen se ignoran. */
function actualizarFilas_(clave, cambios) {
  if (!cambios.length) return;
  var sh = hoja_(clave);
  var titulos = titulos_(sh);
  cambios.forEach(function (c) {
    Object.keys(c.campos).forEach(function (k) {
      var col = titulos.indexOf(k);
      if (col >= 0) sh.getRange(c.fila, col + 1).setValue(c.campos[k]);
    });
  });
  SpreadsheetApp.flush();
}

/** Agrega al final las columnas que aún no existan (no mueve ni toca ninguna otra). */
function asegurarColumnas_(clave) {
  var def = HOJAS[clave];
  var ss = planilla_();
  var sh = ss.getSheetByName(def.nombre);
  if (!sh) {
    if (def.opcional) return;
    if (def.existente) throw new Error('Falta la pestaña "' + def.nombre + '".');
    sh = ss.insertSheet(def.nombre);
  }
  var actuales = sh.getLastColumn() ? titulos_(sh) : [];
  def.titulos.forEach(function (t) {
    if (actuales.indexOf(t) >= 0) return;
    var col = sh.getLastColumn() + 1;
    if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, col).setValue(t).setFontWeight('bold');
    actuales.push(t);
  });
}

/** Claves de App_Ajustes como objeto { clave: valor }. */
function config_() {
  var c = {};
  leerTabla_('inicio').forEach(function (f) { c[f['Clave']] = f['Valor']; });
  return c;
}

/** Anota en App_Registro (lo primero que se mira cuando algo falla). */
function registrar_(evento, detalle) {
  try {
    agregarFilas_('registro', [{ 'Fecha': new Date(), 'Evento': evento, 'Detalle': String(detalle || '').slice(0, 45000) }]);
  } catch (e) {
    console.error(e);
  }
}

function si_(v) {
  return /^(s[ií]|x|true|1)$/i.test(String(v).trim());
}

function norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Número de una celda: acepta números y textos como "0,95" o "-12.990". */
function numero_(v) {
  if (typeof v === 'number') return v;
  var s = String(v == null ? '' : v).trim();
  if (!s) return NaN;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}

/** Lista separada por comas, sin vacíos. */
function separar_(texto) {
  return String(texto || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function hoyISO_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Fecha y hora de una celda como Date, o null. Acepta una fecha real, 'AAAA-MM-DD HH:mm:ss' y el
 * texto largo de JavaScript ("Thu Oct 29 2026 12:40:00 GMT-0300 …"), que es lo que queda guardado
 * cuando la columna tiene formato de texto.
 */
function fechaHora_(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  var s = String(v || '').trim();
  if (!s) return null;
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  var t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

/** Fecha de una celda (Date o texto) como 'AAAA-MM-DD', o '' si no hay. */
function fechaISO_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v || ''));
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
}
