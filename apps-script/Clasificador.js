/**
 * Clasificador de movimientos en 3 capas. Solo funciones puras (sin planilla): se prueban con
 * Node en tests/clasificador.test.js.
 *
 * 1. Memoria por comercio: la "huella" de la glosa (sus palabras, sin números ni símbolos) y lo
 *    que ustedes ya decidieron para esa misma huella. Con 2 decisiones iguales, clasifica sola.
 * 2. Reglas de la pestaña Reglas: palabra clave como palabra completa, gana la más larga, empate
 *    entre categorías distintas = no decide. Igual que el motor de reglas del
 *    proceso que sube los movimientos (que clasifica al subir); las reglas "Recordada" calzan por huella.
 * 3. Modelo (Naive Bayes) entrenado con todo lo confirmado. Solo clasifica solo cuando ya
 *    demostró acertar con sus datos (evaluación dejando uno fuera); si no, solo sugiere.
 *
 * Ante la duda no decide: el movimiento queda "Sin clasificar" con una sugerencia.
 * De las transferencias a personas nunca se clasifica solo por memoria o modelo (lo útil sería
 * un nombre); para eso está "Recordar este destinatario", que crea una regla Recordada.
 */

var SIN_CLASIFICAR = 'Sin clasificar';
var MIN_MEMORIA_AUTO = 2;        // decisiones iguales en la misma huella para clasificar sola
var MIN_EJEMPLOS_MODELO = 30;    // confirmados antes de que el modelo pueda clasificar solo
var MIN_SEGUROS_MODELO = 10;     // casos "seguros" evaluados antes de confiar en el modelo
var PRECISION_MODELO = 0.95;     // acierto exigido al modelo en sus casos seguros
var MIN_SUGERENCIA = 0.4;        // bajo esto el modelo no sugiere nada
var RUIDO_HUELLA = ['cl', 'chl', 'nac', 'int', 'spa', 'ltda'];

function normalizarTexto(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function palabras_(glosa) {
  return normalizarTexto(glosa).match(/[a-z]+/g) || [];
}

/** Lo que identifica al comercio: palabras de 2+ letras, sin números (fechas, sucursal, cuota). */
function huella(glosa) {
  return palabras_(glosa).filter(function (p) { return p.length >= 2 && RUIDO_HUELLA.indexOf(p) < 0; }).slice(0, 5).join(' ');
}

function esTransferencia(glosa) {
  return normalizarTexto(glosa).indexOf('transferencia') >= 0;
}

function esConfirmado(mov, categoriasValidas) {
  return categoriasValidas.indexOf(mov.categoria) >= 0 && (mov.origen === 'Manual' || mov.origen === SIN_CLASIFICAR);
}

function esPendiente(mov) {
  return (!mov.categoria || mov.categoria === SIN_CLASIFICAR) && (!mov.origen || mov.origen === SIN_CLASIFICAR);
}

/* ---------- capa de reglas ---------- */

function crearReglas(registros) {
  return (registros || [])
    .filter(function (r) { return r['Palabra_Clave'] && r['Categoria']; })
    .map(function (r) {
      var palabra = normalizarTexto(r['Palabra_Clave']);
      return {
        palabra: palabra,
        categoria: String(r['Categoria']).trim(),
        recordada: String(r['Origen'] || '').trim() === 'Recordada',
        re: new RegExp('(^|[^a-z])' + palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z])')
      };
    })
    .sort(function (a, b) { return b.palabra.length - a.palabra.length; });
}

/** La regla más específica que calza, o null si no calza ninguna o hay empate entre categorías. */
function aplicarReglas(reglas, glosa) {
  var texto = normalizarTexto(glosa), h = huella(glosa), mejor = null, categorias = {};
  for (var i = 0; i < reglas.length; i++) {
    var r = reglas[i];
    if (!(r.re.test(texto) || (r.recordada && r.palabra === h))) continue;
    if (mejor && r.palabra.length < mejor.palabra.length) break;
    mejor = mejor || r;
    categorias[r.categoria] = true;
  }
  return mejor && Object.keys(categorias).length === 1 ? mejor : null;
}

/* ---------- capa de memoria por comercio ---------- */

function crearMemoria(confirmados) {
  var m = {};
  confirmados.forEach(function (f) {
    var h = huella(f.glosa);
    if (!h) return;
    m[h] = m[h] || {};
    m[h][f.categoria] = (m[h][f.categoria] || 0) + 1;
  });
  return m;
}

/** { categoria (la más votada), veces, total } o null si esa huella nunca se clasificó. */
function consultarMemoria(memoria, glosa) {
  var votos = memoria[huella(glosa)];
  if (!votos) return null;
  var total = 0, mejor = null;
  Object.keys(votos).forEach(function (c) {
    total += votos[c];
    if (!mejor || votos[c] > votos[mejor]) mejor = c;
  });
  return { categoria: mejor, veces: votos[mejor], total: total };
}

/* ---------- capa del modelo (Naive Bayes) ---------- */

function rasgos(mov) {
  var r = {};
  palabras_(mov.glosa).forEach(function (p) { if (p.length >= 3) r['p:' + p] = true; });
  var monto = +mov.monto || 0;
  r['c:' + normalizarTexto(mov.cuenta)] = true;
  r['s:' + (monto < 0 ? '-' : '+')] = true;
  r['m:' + Math.floor(Math.log(Math.abs(monto) + 1) / Math.LN10)] = true;
  return Object.keys(r);
}

function sumarAlModelo_(modelo, categoria, rs, signo) {
  var c = modelo.categorias[categoria] || (modelo.categorias[categoria] = { docs: 0, total: 0, conteos: {} });
  c.docs += signo;
  modelo.docs += signo;
  rs.forEach(function (r) {
    c.conteos[r] = (c.conteos[r] || 0) + signo;
    c.total += signo;
    modelo.vocabulario[r] = (modelo.vocabulario[r] || 0) + signo;
  });
}

function entrenarModelo(confirmados) {
  var modelo = { docs: 0, categorias: {}, vocabulario: {} };
  confirmados.forEach(function (f) { sumarAlModelo_(modelo, f.categoria, rasgos(f), 1); });
  return modelo;
}

/** { categoria, prob } de la categoría más probable, o null si el modelo está vacío. */
function predecir(modelo, mov, rs) {
  rs = rs || rasgos(mov);
  var V = Object.keys(modelo.vocabulario).length || 1, logs = {}, max = -Infinity;
  Object.keys(modelo.categorias).forEach(function (cat) {
    var c = modelo.categorias[cat];
    if (c.docs <= 0) return;
    var l = Math.log(c.docs / modelo.docs);
    rs.forEach(function (r) {
      if (modelo.vocabulario[r] > 0) l += Math.log(((c.conteos[r] || 0) + 1) / (c.total + V));
    });
    logs[cat] = l;
    if (l > max) max = l;
  });
  var suma = 0, mejor = null;
  Object.keys(logs).forEach(function (cat) {
    suma += Math.exp(logs[cat] - max);
    if (!mejor || logs[cat] > logs[mejor]) mejor = cat;
  });
  return mejor ? { categoria: mejor, prob: 1 / suma } : null;
}

/**
 * Qué tan bien le iría al modelo con sus propios datos: cada confirmado se predice con un modelo
 * entrenado con todos los demás. "Seguros" son los casos con prob >= umbral.
 */
function evaluarModelo(confirmados, umbral) {
  var modelo = entrenarModelo(confirmados), n = 0, aciertos = 0, seguros = 0, segurosOk = 0;
  confirmados.forEach(function (f) {
    var rs = rasgos(f);
    sumarAlModelo_(modelo, f.categoria, rs, -1);
    var p = predecir(modelo, f, rs);
    sumarAlModelo_(modelo, f.categoria, rs, 1);
    if (!p) return;
    n++;
    var ok = p.categoria === f.categoria;
    if (ok) aciertos++;
    if (p.prob >= umbral) { seguros++; if (ok) segurosOk++; }
  });
  return {
    ejemplos: confirmados.length,
    acierto: n ? aciertos / n : 0,
    seguros: seguros,
    precisionSeguros: seguros ? segurosOk / seguros : 0,
    confiable: confirmados.length >= MIN_EJEMPLOS_MODELO && seguros >= MIN_SEGUROS_MODELO && segurosOk / seguros >= PRECISION_MODELO
  };
}

/* ---------- las 3 capas juntas ---------- */

/**
 * reglasRegistros: filas de Reglas. confirmados: [{ glosa, monto, cuenta, categoria }].
 * Devuelve { evaluacion, clasificar(mov) -> { categoria, auto, confianza, motivo } | null }.
 */
function crearClasificador(reglasRegistros, confirmados, opciones) {
  var umbral = (opciones && opciones.confianzaAuto) || 0.95;
  var reglas = crearReglas(reglasRegistros);
  var memoria = crearMemoria(confirmados);
  var modelo = entrenarModelo(confirmados);
  var evaluacion = evaluarModelo(confirmados, umbral);

  function clasificar(mov) {
    var transferencia = esTransferencia(mov.glosa);
    var mem = consultarMemoria(memoria, mov.glosa);
    if (mem && !transferencia && mem.veces === mem.total && mem.total >= MIN_MEMORIA_AUTO) {
      return { categoria: mem.categoria, auto: true, confianza: 1, motivo: 'Ya lo clasificaron ' + mem.total + ' veces así' };
    }
    var regla = aplicarReglas(reglas, mov.glosa);
    if (regla) return { categoria: regla.categoria, auto: true, confianza: 1, motivo: 'Regla «' + regla.palabra + '»' };

    var p = predecir(modelo, mov);
    var modeloSeguro = p && evaluacion.confiable && p.prob >= umbral && !transferencia;
    if (mem) {
      if (modeloSeguro && p.categoria === mem.categoria) {
        return { categoria: p.categoria, auto: true, confianza: redondear_(p.prob), motivo: 'Memoria y modelo coinciden' };
      }
      return {
        categoria: mem.categoria, auto: false,
        confianza: redondear_(mem.veces / mem.total * (mem.total >= 2 ? 0.95 : 0.8)),
        motivo: mem.total === 1 ? 'La vez anterior fue ' + mem.categoria : mem.veces + ' de ' + mem.total + ' veces fue ' + mem.categoria
      };
    }
    if (modeloSeguro) return { categoria: p.categoria, auto: true, confianza: redondear_(p.prob), motivo: 'Modelo (' + Math.round(p.prob * 100) + ' %)' };
    if (p && p.prob >= MIN_SUGERENCIA) return { categoria: p.categoria, auto: false, confianza: redondear_(p.prob), motivo: 'Parecido a otros de ' + p.categoria };
    return null;
  }

  return { evaluacion: evaluacion, clasificar: clasificar };
}

function redondear_(x) {
  return Math.round(x * 100) / 100;
}

/**
 * Qué cambiar en Movimientos (sin tocar la planilla). movs: [{ fila, glosa, monto, cuenta,
 * categoria, origen, sugerencia, confianza }]. Devuelve { cambios: [{ fila, campos }],
 * resultados: { fila: resultado de clasificar }, evaluacion }.
 *
 * - Lo clasificado a mano en la planilla (Origen "Sin clasificar" con categoría válida) queda Manual.
 * - Lo pendiente se clasifica solo si hay certeza; si no, se anota la sugerencia.
 * - Lo Auto se corrige si ahora hay certeza de otra categoría (aprendió algo nuevo).
 * - Lo Manual nunca se toca.
 */
function planificarClasificacion(movs, reglasRegistros, categoriasValidas, opciones) {
  var confirmados = movs.filter(function (m) { return esConfirmado(m, categoriasValidas); });
  var clasificador = crearClasificador(reglasRegistros, confirmados, opciones);
  var cambios = [], resultados = {};
  movs.forEach(function (m) {
    if (esConfirmado(m, categoriasValidas)) {
      if (m.origen !== 'Manual') cambios.push({ fila: m.fila, campos: { 'Origen': 'Manual', 'Clasificado_Por': 'Planilla', 'Sugerencia': '', 'Confianza': '' } });
      return;
    }
    var r;
    if (esPendiente(m)) {
      r = clasificador.clasificar(m);
      resultados[m.fila] = r;
      if (r && r.auto) {
        cambios.push({ fila: m.fila, campos: { 'Categoria': r.categoria, 'Origen': 'Auto', 'Clasificado_Por': 'Auto · ' + r.motivo, 'Sugerencia': '', 'Confianza': r.confianza } });
      } else {
        var sug = r ? r.categoria : '', conf = r ? r.confianza : '';
        var campos = {};
        if (m.categoria !== SIN_CLASIFICAR) campos['Categoria'] = SIN_CLASIFICAR;
        if (m.origen !== SIN_CLASIFICAR) campos['Origen'] = SIN_CLASIFICAR;
        if (String(m.sugerencia || '') !== sug) campos['Sugerencia'] = sug;
        if (String(m.confianza === undefined || m.confianza === null ? '' : m.confianza) !== String(conf)) campos['Confianza'] = conf;
        if (Object.keys(campos).length) cambios.push({ fila: m.fila, campos: campos });
      }
    } else if (m.origen === 'Auto') {
      r = clasificador.clasificar(m);
      resultados[m.fila] = r;
      if (r && r.auto && r.categoria !== m.categoria) {
        cambios.push({ fila: m.fila, campos: { 'Categoria': r.categoria, 'Clasificado_Por': 'Auto · ' + r.motivo, 'Confianza': r.confianza } });
      }
    }
  });
  return { cambios: cambios, resultados: resultados, evaluacion: clasificador.evaluacion };
}

// Para las pruebas con Node (en Apps Script no existe `module`).
if (typeof module !== 'undefined') {
  module.exports = {
    SIN_CLASIFICAR: SIN_CLASIFICAR, normalizarTexto: normalizarTexto, huella: huella, esTransferencia: esTransferencia,
    crearReglas: crearReglas, aplicarReglas: aplicarReglas, crearMemoria: crearMemoria, consultarMemoria: consultarMemoria,
    entrenarModelo: entrenarModelo, predecir: predecir, evaluarModelo: evaluarModelo,
    crearClasificador: crearClasificador, planificarClasificacion: planificarClasificacion
  };
}
