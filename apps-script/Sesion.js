/**
 * Inicio de sesión con Google y sesiones de larga duración.
 *
 * 1. La app obtiene un "ID token" de Google (botón Entrar con Google) y lo manda a accion=entrar.
 * 2. Aquí se verifica con Google, se busca a la persona por su correo en App_Personas y se entrega
 *    un token de sesión propio (firmado con HMAC), válido por DIAS_SESION.
 * Solo entran los correos de App_Personas: cualquier otro no recibe ningún dato.
 */

var DIAS_SESION = 180;

function secretoSesion_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SECRETO_SESION');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SECRETO_SESION', s);
  }
  return s;
}

function firmar_(texto) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, secretoSesion_())).replace(/=+$/, '');
}

function crearSesion_(correo) {
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: correo, x: Date.now() + DIAS_SESION * 864e5 })).replace(/=+$/, '');
  return payload + '.' + firmar_(payload);
}

/** Devuelve el correo de la sesión o null si el token no es válido o venció. */
function leerSesion_(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  var partes = String(token).split('.');
  if (firmar_(partes[0]) !== partes[1]) return null;
  try {
    var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString());
    return p.x > Date.now() ? String(p.e).toLowerCase() : null;
  } catch (e) {
    return null;
  }
}

/** Verifica el ID token de Google y devuelve el correo, o lanza un error legible. */
function verificarGoogle_(idToken, cfg) {
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('No se pudo verificar la cuenta de Google. Intenta de nuevo.');
  var t = JSON.parse(r.getContentText());
  if (!String(cfg.googleClientId || '').trim()) throw new Error('Falta googleClientId en App_Ajustes.');
  if (t.aud !== String(cfg.googleClientId).trim()) throw new Error('Credencial de Google no corresponde a esta app.');
  if (String(t.email_verified) !== 'true') throw new Error('La cuenta de Google no tiene el correo verificado.');
  return String(t.email).toLowerCase();
}

/**
 * Quién es el usuario según App_Personas.
 * rol: 'admin' (además ve el enlace a la planilla) | 'editor'. Ambos pueden ver y clasificar todo.
 */
function perfil_(correo) {
  correo = String(correo || '').toLowerCase();
  var persona = leerTabla_('personas').filter(function (p) { return String(p['Correo']).trim().toLowerCase() === correo; })[0];
  return {
    correo: correo,
    registrado: !!persona,
    nombre: persona && String(persona['Nombre']).trim() ? String(persona['Nombre']).trim() : correo,
    rol: persona ? norm_(persona['Rol']) : ''
  };
}
