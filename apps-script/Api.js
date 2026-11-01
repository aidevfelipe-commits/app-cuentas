/**
 * API que consume la app web (GitHub Pages). Todo requiere sesión, salvo ping.
 *
 * POST (cuerpo JSON enviado como text/plain para evitar CORS):
 *   { accion: 'entrar', credential }                          -> { token, usuario }
 *   { accion: 'datos', token }                                -> movimientos ya clasificados
 *   { accion: 'clasificar', token, ids, categoria, nota?, recordar? }
 *   { accion: 'confirmar', token, ids }                       (revisé las automáticas)
 *   { accion: 'nota', token, ids: [id], nota }
 *   { accion: 'regla', token, palabra, categoria }           (solo admin: regla fija en Reglas)
 *   { accion: 'eliminarCopiasSigno', token, ids }            (solo admin: copias de abonos con signo de cargo)
 *   { accion: 'diagnostico', token }                          (solo admin: estructura, sin datos de movimientos)
 * Las que escriben devuelven lo mismo que 'datos', ya actualizado.
 *
 * Todo pasa por conBloqueo_: 'datos' también escribe (clasifica lo que subió el scraper).
 */

function doGet(e) {
  var accion = (e && e.parameter && e.parameter.accion) || '';
  if (accion === 'ping') return json_({ ok: true, hora: new Date().toISOString() });
  return json_({ ok: false, error: 'Inicia sesión en la app.' });
}

function doPost(e) {
  var p;
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Solicitud inválida' });
  }
  try {
    var cfg = config_();
    if (p.accion === 'entrar') {
      var correo = verificarGoogle_(p.credential, cfg);
      var perfil = perfil_(correo);
      if (!perfil.registrado) {
        registrar_('Acceso rechazado', correo);
        return json_({ ok: false, error: 'Tu correo (' + correo + ') no tiene acceso. Pide que te agreguen en App_Personas.' });
      }
      return json_({ ok: true, token: crearSesion_(correo), usuario: perfil });
    }

    var correoSesion = leerSesion_(p.token);
    if (!correoSesion) return json_({ ok: false, codigo: 'sesion', error: 'Tu sesión terminó. Vuelve a entrar.' });
    var yo = perfil_(correoSesion);
    if (!yo.registrado) return json_({ ok: false, codigo: 'sesion', error: 'Tu correo ya no tiene acceso.' });

    switch (p.accion) {
      case 'datos': return json_(conBloqueo_(function () { return datosUsuario_(yo, cfg, pasadaClasificador_(cfg)); }));
      case 'clasificar': return json_(conBloqueo_(function () { return clasificar_(yo, cfg, p); }));
      case 'confirmar': return json_(conBloqueo_(function () { return confirmar_(yo, cfg, p); }));
      case 'nota': return json_(conBloqueo_(function () { return guardarNota_(yo, cfg, p); }));
      case 'regla': return json_(conBloqueo_(function () { return agregarRegla_(yo, cfg, p); }));
      case 'eliminarCopiasSigno': return json_(conBloqueo_(function () { return eliminarCopiasSigno_(yo, cfg, p); }));
      case 'diagnostico': return json_(diagnostico_(yo));
      default: return json_({ ok: false, error: 'Acción desconocida' });
    }
  } catch (err) {
    console.error(err);
    registrar_('Error en la API', (p && p.accion) + ': ' + (err.stack || err.message));
    return json_({ ok: false, error: err.message || 'Error interno' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Evita que dos personas (o la tarea horaria) escriban a la vez en la planilla. */
function conBloqueo_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Solo para revisar problemas: títulos de Movimientos y qué tipo de valor hay en las columnas de la app. Nunca glosas ni montos. */
function diagnostico_(yo) {
  if (yo.rol !== 'admin') return { ok: false, error: 'Solo admin.' };
  var sh = hoja_('movimientos'), titulos = titulos_(sh), filas = sh.getDataRange().getValues().slice(1);
  var tipos = {};
  ['Sugerencia', 'Confianza', 'Clasificado_Por', 'Fecha_Clasif', 'Origen'].forEach(function (t) {
    var c = titulos.indexOf(t), cuenta = {};
    if (c < 0) { tipos[t] = 'no existe'; return; }
    filas.forEach(function (f) {
      var v = f[c], k = v === '' ? 'vacío' : v instanceof Date ? 'fecha' : typeof v;
      cuenta[k] = (cuenta[k] || 0) + 1;
    });
    var formatos = {};
    sh.getRange(2, c + 1, Math.max(filas.length, 1), 1).getNumberFormats().forEach(function (f) { formatos[f[0]] = (formatos[f[0]] || 0) + 1; });
    tipos[t] = { columna: c + 1, formatos: formatos, valores: cuenta };
  });
  return { ok: true, titulos: titulos, maxColumnas: sh.getMaxColumns(), maxFilas: sh.getMaxRows(), filas: filas.length, tipos: tipos };
}
