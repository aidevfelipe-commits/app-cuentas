/**
 * Movimientos: lectura, la pasada del clasificador y las acciones que llegan desde la app.
 *
 * Los movimientos se ubican por ID (no por número de fila): si alguien ordena la planilla mientras
 * la app está abierta, se escribe igual en la fila correcta. La app nunca inserta ni borra filas:
 * el proceso que sube los datos agrega al final y ubica sus filas por posición.
 */

function categorias_(cfg) {
  var presupuesto = separar_(cfg.categorias), especiales = separar_(cfg.categoriasEspeciales);
  return { presupuesto: presupuesto, especiales: especiales, todas: presupuesto.concat(especiales) };
}

function leerMovimientos_() {
  return leerTabla_('movimientos').map(function (f) {
    var monto = numero_(f['Monto']);
    return {
      fila: f._fila,
      id: String(f['ID'] || '').trim(),
      fecha: fechaISO_(f['Fecha']),
      glosa: String(f['Glosa'] || ''),
      monto: isNaN(monto) ? 0 : monto,
      moneda: String(f['Moneda'] || '').trim().toUpperCase() || 'CLP',
      cuenta: String(f['Cuenta'] || ''),
      categoria: String(f['Categoria'] || '').trim(),
      origen: String(f['Origen'] || '').trim(),
      nota: String(f['Nota'] || ''),
      sugerencia: String(f['Sugerencia'] || '').trim(),
      confianza: confianzaDeCelda_(f['Confianza']),
      porQuien: String(f['Clasificado_Por'] || ''),
      fechaClasif: fechaISO_(fechaHora_(f['Fecha_Clasif']) || ''),
      clasificadoEn: fechaHora_(f['Fecha_Clasif']) ? fechaHora_(f['Fecha_Clasif']).toISOString() : ''
    };
  });
}

/**
 * Escribe los cambios en Movimientos y en los objetos ya leídos. Anota Fecha_Clasif al decidir una
 * categoría, como texto 'AAAA-MM-DD HH:mm:ss' (se lee bien aunque la columna tenga formato de texto).
 */
function aplicarCambios_(movs, cambios) {
  var ahora = new Date(), porFila = {};
  var ahoraTexto = Utilities.formatDate(ahora, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  movs.forEach(function (m) { porFila[m.fila] = m; });
  cambios.forEach(function (c) {
    var o = c.campos['Origen'];
    if (!('Fecha_Clasif' in c.campos) && (o === 'Manual' || o === 'Auto' || (c.campos['Categoria'] && c.campos['Categoria'] !== SIN_CLASIFICAR))) c.campos['Fecha_Clasif'] = ahoraTexto;
  });
  // La confianza se escribe como "87%": así Sheets le da formato de porcentaje a la celda al escribirla,
  // aunque arrastre un formato antiguo de fecha (si no, la devuelve como fecha y se reescribiría siempre).
  actualizarFilas_('movimientos', cambios.map(function (c) {
    var campos = Object.assign({}, c.campos);
    if (typeof campos['Confianza'] === 'number') campos['Confianza'] = Math.round(campos['Confianza'] * 100) + '%';
    return { fila: c.fila, campos: campos };
  }));
  var CAMPO = { 'Categoria': 'categoria', 'Origen': 'origen', 'Nota': 'nota', 'Sugerencia': 'sugerencia', 'Confianza': 'confianza', 'Clasificado_Por': 'porQuien' };
  cambios.forEach(function (c) {
    var m = porFila[c.fila];
    if (!m) return;
    Object.keys(c.campos).forEach(function (k) { if (CAMPO[k]) m[CAMPO[k]] = c.campos[k]; });
    if (c.campos['Fecha_Clasif'] === ahoraTexto) { m.fechaClasif = hoyISO_(); m.clasificadoEn = ahora.toISOString(); }
    if (c.campos['Fecha_Clasif'] === '') { m.fechaClasif = ''; m.clasificadoEn = ''; }
  });
}

/** Clasifica lo pendiente, anota sugerencias y marca como Manual lo clasificado en la planilla. Va dentro de conBloqueo_. */
function pasadaClasificador_(cfg) {
  var movs = leerMovimientos_();
  var plan = planificarClasificacion(movs, leerTabla_('reglas'), categorias_(cfg).todas, { confianzaAuto: numero_(cfg.confianzaAuto) || 0.95 });
  aplicarCambios_(movs, plan.cambios);
  var auto = plan.cambios.filter(function (c) { return c.campos['Origen'] === 'Auto'; }).length;
  if (auto) registrar_('Clasificación automática', auto + ' movimiento(s)');
  return { movs: movs, plan: plan };
}

/** Lo que ve la app: los movimientos de los últimos meses (y todo lo pendiente), ya clasificados. */
function datosUsuario_(yo, cfg, pasada) {
  var meses = Math.max(1, Math.round(numero_(cfg.mesesEnApp)) || 6);
  var hoy = new Date();
  var desde = Utilities.formatDate(new Date(hoy.getFullYear(), hoy.getMonth() - meses + 1, 1), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  // Lo anterior al inicio del control no se muestra ni se pide clasificar (igual sigue enseñando al clasificador)
  var inicio = fechaISO_(cfg.inicioControl);
  if (inicio && inicio > desde) desde = inicio;
  var movimientos = pasada.movs
    .filter(function (m) { return m.id && (m.fecha >= desde || (esPendiente(m) && (!inicio || m.fecha >= inicio))); })
    .map(function (m) {
      var r = pasada.plan.resultados[m.fila];
      var pendiente = esPendiente(m) || !m.categoria || m.categoria === SIN_CLASIFICAR;
      return {
        id: m.id, fecha: m.fecha, glosa: m.glosa, monto: m.monto, moneda: m.moneda, cuenta: m.cuenta,
        categoria: pendiente ? SIN_CLASIFICAR : m.categoria,
        origen: pendiente ? SIN_CLASIFICAR : (m.origen === 'Auto' ? 'Auto' : 'Manual'),
        nota: m.nota, porQuien: m.porQuien, fechaClasif: m.fechaClasif, clasificadoEn: m.clasificadoEn,
        huella: huella(m.glosa), transferencia: esTransferencia(m.glosa),
        sugerencia: pendiente && r ? r.categoria : '',
        confianza: pendiente && r ? r.confianza : '',
        motivo: pendiente && r ? r.motivo : (m.origen === 'Auto' ? m.porQuien.replace(/^Auto · /, '') : '')
      };
    })
    .sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });
  return {
    ok: true,
    usuario: yo,
    nombreApp: String(cfg.nombreApp || 'Cuentas'),
    categorias: categorias_(cfg),
    movimientos: movimientos,
    desde: desde,
    presupuesto: leerPresupuesto_(),
    pendientes: leerPendientes_(),
    saldos: leerSaldos_(),
    tipoCambio: numero_(cfg.tipoCambio) || 0,
    modelo: pasada.plan.evaluacion,
    planilla: yo.rol === 'admin' ? planilla_().getUrl() : ''
  };
}

/** Ubica los movimientos por ID, o lanza un error si alguno ya no está. */
function ubicar_(movs, ids) {
  var porId = {};
  movs.forEach(function (m) { if (m.id) porId[m.id] = m; });
  ids = (ids || []).map(String);
  if (!ids.length) throw new Error('No se indicó ningún movimiento.');
  if (ids.length > 300) throw new Error('Demasiados movimientos de una vez.');
  return ids.map(function (id) {
    if (!porId[id]) throw new Error('Un movimiento ya no está en la planilla (¿se borró o cambió?). Actualiza la app.');
    return porId[id];
  });
}

/**
 * Clasifica a mano: { ids, categoria, nota?, recordar? }. categoria = "Sin clasificar" deshace.
 * recordar (transferencias): crea una regla Recordada para que ese destinatario se clasifique solo.
 */
function clasificar_(yo, cfg, p) {
  var categoria = String(p.categoria || '').trim();
  var cats = categorias_(cfg);
  if (categoria !== SIN_CLASIFICAR && cats.todas.indexOf(categoria) < 0) throw new Error('Categoría desconocida: ' + categoria);
  var movs = leerMovimientos_();
  var elegidos = ubicar_(movs, p.ids);
  var deshacer = categoria === SIN_CLASIFICAR;
  var cambios = elegidos.map(function (m) {
    return {
      fila: m.fila,
      campos: deshacer
        ? { 'Categoria': SIN_CLASIFICAR, 'Origen': SIN_CLASIFICAR, 'Clasificado_Por': '', 'Fecha_Clasif': '' }
        : { 'Categoria': categoria, 'Origen': 'Manual', 'Clasificado_Por': yo.nombre, 'Sugerencia': '', 'Confianza': '' }
    };
  });
  if (p.nota !== undefined && elegidos.length === 1) cambios[0].campos['Nota'] = String(p.nota).slice(0, 500);
  // Origen solo admite Auto/Manual/Sin clasificar: si alguien escribió ahí un apunte, se pasa a Nota en vez de perderlo
  elegidos.forEach(function (m, i) {
    if (['', 'Auto', 'Manual', SIN_CLASIFICAR].indexOf(m.origen) >= 0) return;
    var nota = 'Nota' in cambios[i].campos ? cambios[i].campos['Nota'] : m.nota;
    cambios[i].campos['Nota'] = (nota ? nota + ' · ' : '') + m.origen;
  });
  aplicarCambios_(movs, cambios);
  if (p.recordar && !deshacer) recordarDestinatario_(elegidos[0], categoria, yo);
  return datosUsuario_(yo, cfg, pasadaClasificador_(cfg));
}

function recordarDestinatario_(mov, categoria, yo) {
  var h = huella(mov.glosa);
  if (!h) return;
  var existe = leerTabla_('reglas').some(function (r) { return normalizarTexto(r['Palabra_Clave']) === h; });
  if (existe) return;
  agregarFilas_('reglas', [{ 'Palabra_Clave': h, 'Categoria': categoria, 'Origen': 'Recordada', 'Fecha_Creacion': hoyISO_() }]);
  registrar_('Regla recordada', yo.nombre + ': «' + h + '» → ' + categoria);
}

/** Da por revisadas las clasificaciones automáticas: { ids }. Pasan a Manual y enseñan al clasificador. */
function confirmar_(yo, cfg, p) {
  var movs = leerMovimientos_();
  var cambios = ubicar_(movs, p.ids)
    .filter(function (m) { return m.origen === 'Auto'; })
    .map(function (m) { return { fila: m.fila, campos: { 'Origen': 'Manual', 'Clasificado_Por': yo.nombre + ' (revisó)' } }; });
  aplicarCambios_(movs, cambios);
  return datosUsuario_(yo, cfg, pasadaClasificador_(cfg));
}

/** Cambia la nota de un movimiento: { ids: [id], nota }. */
function guardarNota_(yo, cfg, p) {
  var movs = leerMovimientos_();
  var m = ubicar_(movs, p.ids)[0];
  aplicarCambios_(movs, [{ fila: m.fila, campos: { 'Nota': String(p.nota || '').slice(0, 500) } }]);
  return datosUsuario_(yo, cfg, pasadaClasificador_(cfg));
}

/** Crea una regla fija en la pestaña Reglas: { palabra, categoria }. Solo admin. */
function agregarRegla_(yo, cfg, p) {
  if (yo.rol !== 'admin') throw new Error('Solo el administrador puede crear reglas.');
  var palabra = normalizarTexto(p.palabra), categoria = String(p.categoria || '').trim();
  if (palabra.length < 3) throw new Error('La palabra clave es muy corta.');
  if (categorias_(cfg).todas.indexOf(categoria) < 0) throw new Error('Categoría desconocida: ' + categoria);
  var ya = leerTabla_('reglas').filter(function (r) { return normalizarTexto(r['Palabra_Clave']) === palabra; })[0];
  if (ya && String(ya['Categoria']).trim() !== categoria) throw new Error('Ya existe la regla «' + palabra + '» con ' + ya['Categoria'] + '.');
  if (!ya) {
    agregarFilas_('reglas', [{ 'Palabra_Clave': palabra, 'Categoria': categoria, 'Origen': 'Manual', 'Fecha_Creacion': hoyISO_() }]);
    registrar_('Regla creada', yo.nombre + ': «' + palabra + '» → ' + categoria);
  }
  return datosUsuario_(yo, cfg, pasadaClasificador_(cfg));
}

/** Confianza de una celda como número 0–1. Una fecha (formato antiguo de la celda) cuenta como "por reescribir". */
function confianzaDeCelda_(v) {
  if (v instanceof Date) return 'formato';
  if (typeof v === 'string' && /%$/.test(v.trim())) return numero_(v.trim().slice(0, -1)) / 100;
  return v === undefined ? '' : v;
}

/**
 * Presupuesto_Mensual como { porDefecto: { categoria: monto }, meses: { 'AAAA-MM': { categoria: monto } } }.
 * Igual que la hoja Resumen: si una categoría tiene fila para ese mes manda esa; si no, la Default.
 */
function leerPresupuesto_() {
  var r = { porDefecto: {}, meses: {} };
  leerTabla_('presupuesto', { opcional: true }).forEach(function (f) {
    var cat = String(f['Categoria'] || '').trim(), monto = numero_(f['Monto_Presupuestado']);
    if (!cat || isNaN(monto)) return;
    var mes = String(f['Mes'] || '').trim();
    if (norm_(mes) === 'default') { r.porDefecto[cat] = (r.porDefecto[cat] || 0) + monto; return; }
    var ym = (fechaISO_(fechaHora_(f['Mes']) || '') || fechaISO_(mes)).slice(0, 7);
    if (!ym) return;
    r.meses[ym] = r.meses[ym] || {};
    r.meses[ym][cat] = (r.meses[ym][cat] || 0) + monto;
  });
  return r;
}

/** Pendientes con Estado "Pendiente" como { 'AAAA-MM': { categoria: monto } } (por fecha estimada). */
function leerPendientes_() {
  var r = {};
  leerTabla_('pendientes', { opcional: true }).forEach(function (f) {
    if (norm_(f['Estado']) !== 'pendiente') return;
    var cat = String(f['Categoria'] || '').trim(), monto = numero_(f['Monto_Estimado']);
    var ym = fechaISO_(fechaHora_(f['Fecha_Estimada']) || '').slice(0, 7);
    if (!cat || isNaN(monto) || !ym) return;
    r[ym] = r[ym] || {};
    r[ym][cat] = (r[ym][cat] || 0) + monto;
  });
  return r;
}

/** Último valor de cada (Cuenta, Concepto) de la pestaña Saldos, que llena el scraper al entrar al banco. */
function leerSaldos_() {
  var ultimos = {};
  leerTabla_('saldos', { opcional: true }).forEach(function (f) {
    var fecha = fechaHora_(f['Fecha']), monto = numero_(f['Monto']);
    var cuenta = String(f['Cuenta'] || '').trim(), concepto = String(f['Concepto'] || '').trim();
    if (!fecha || isNaN(monto) || !concepto) return;
    var clave = cuenta + '|' + concepto;
    if (!ultimos[clave] || ultimos[clave].fecha < fecha) ultimos[clave] = { cuenta: cuenta, concepto: concepto, monto: monto, fecha: fecha };
  });
  return Object.keys(ultimos).map(function (k) {
    var u = ultimos[k];
    return { cuenta: u.cuenta, concepto: u.concepto, monto: u.monto, leidoEn: u.fecha.toISOString() };
  });
}
