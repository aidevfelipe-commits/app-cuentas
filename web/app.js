(function () {
  'use strict';

  var CLAVE_SESION = 'cuentas-sesion-v1';
  var CLAVE_DATOS = 'cuentas-datos-v1';
  var VERSION_APP = 'v5'; // igual que VERSION en sw.js (subir ambas en cada cambio)
  var NOMBRE = 'Cuentas';
  var SIN = 'Sin clasificar';
  var MAX_AUTOS = 30;
  var MAX_RECIENTES = 10;

  var cfg = window.APP_CONFIG || {};
  var DEMO = /[?&]demo\b/.test(location.search) || !cfg.apiUrl;
  var estado = {
    datos: null, token: null, sinConexion: false, error: '',
    enCurso: 0, ultimo: null, huboError: false,
    separados: {}, abierto: null, mes: '', filtroCat: '', filtroCuenta: '', busqueda: '', verTodasAutos: false
  };
  var cola = Promise.resolve();
  var app = document.getElementById('app');
  var eventoInstalar = null;

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  function fechaCorta(iso) {
    if (!iso) return 'sin fecha';
    var p = iso.split('-');
    return +p[2] + ' ' + MESES[+p[1] - 1].slice(0, 3);
  }
  function fechaDia(iso) {
    if (!iso) return 'Sin fecha';
    var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    var t = DIAS[d.getDay()] + ' ' + +p[2] + ' de ' + MESES[+p[1] - 1];
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function nombreMes(ym) {
    var p = ym.split('-');
    return MESES[+p[1] - 1].charAt(0).toUpperCase() + MESES[+p[1] - 1].slice(1) + ' ' + p[0];
  }
  function mesDe(iso) { return String(iso || '').slice(0, 7); }
  function mesMas(ym, n) {
    var p = ym.split('-'), d = new Date(+p[0], +p[1] - 1 + n, 1);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }
  var fmtCLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
  var fmtUSD = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  function dinero(monto, moneda) { return (monto < 0 ? '-' : '') + (moneda === 'USD' ? fmtUSD : fmtCLP).format(Math.abs(monto)); }
  function claseMonto(m) { return m.monto < 0 ? 'gasto' : 'abono'; }
  function cuentaCorta(c) { return /tarjeta/i.test(c) ? 'Tarjeta' : /corriente/i.test(c) ? 'Cuenta corriente' : c; }
  function primerNombre(n) { return String(n || '').split(/[ @]/)[0]; }
  function leer(clave) { try { return JSON.parse(localStorage.getItem(clave) || 'null'); } catch (e) { return null; } }
  function guardar(clave, v) { try { if (v == null) localStorage.removeItem(clave); else localStorage.setItem(clave, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  function categorias() { var c = estado.datos.categorias; return c.presupuesto.concat(c.especiales); }
  /** Color fijo por categoría (variables --c0…--c9 en styles.css). */
  function colorCat(cat) {
    var i = categorias().indexOf(cat);
    return i < 0 ? 'var(--suave)' : 'var(--c' + (i % 10) + ')';
  }
  function movimientos() { return estado.datos.movimientos || []; }
  function porId(id) { return movimientos().filter(function (m) { return m.id === id; })[0]; }
  function pendientes() { return movimientos().filter(function (m) { return m.origen === SIN; }); }

  /* ---------- servidor ---------- */
  // text/plain evita la consulta previa de CORS, que Apps Script no responde.
  function api(accion, datos) {
    if (DEMO) return demoApi(accion, datos || {});
    var cuerpo = Object.assign({ accion: accion, token: estado.token }, datos || {});
    return fetch(cfg.apiUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo) })
      .then(function (r) { if (!r.ok) throw new Error('red'); return r.json(); })
      .then(function (r) {
        if (!r.ok && r.codigo === 'sesion') { salir(r.error); throw new Error('sesion'); }
        return r;
      });
  }

  /** Muestra al tiro lo guardado en el teléfono y luego lo actualiza desde el servidor. */
  function cargar() {
    if (!estado.token && !DEMO) { renderLogin(); return; }
    if (estado.enCurso) return; // hay cambios en camino: su respuesta trae lo último
    var cache = DEMO ? null : leer(CLAVE_DATOS);
    if (cache && !estado.datos) { estado.datos = cache; elegirMes(); render(); }
    estado.cargando = true;
    if (estado.datos) render();
    var pedido = DEMO ? fetch('dev-data.json', { cache: 'no-store' }).then(function (r) { return r.json(); }) : api('datos');
    pedido.then(function (d) {
      if (!d || !d.ok) throw new Error(d && d.error || 'respuesta inválida');
      if (estado.enCurso) return;
      recibir(d);
      estado.sinConexion = false;
    }).catch(function (e) {
      if (e.message === 'sesion') return;
      estado.sinConexion = true;
      if (e.message !== 'red') aviso(e.message, true);
    }).then(function () { estado.cargando = false; if (estado.datos || estado.sinConexion) render(); });
  }

  function recibir(d) {
    estado.datos = d;
    if (!DEMO) guardar(CLAVE_DATOS, d);
    elegirMes();
  }

  /** El mes que se muestra: el más reciente con movimientos (o el actual), si aún no se eligió uno. */
  function elegirMes() {
    if (estado.mes) return;
    estado.mes = mesDe(((estado.datos.movimientos || [])[0] || {}).fecha) || mesDe(new Date().toISOString());
  }

  /**
   * Cambio optimista: se aplica al tiro en pantalla y se envía en orden. Cuando termina el último
   * envío se muestra lo que respondió el servidor (que además clasificó lo parecido).
   */
  function enviar(accion, datos, aplicarLocal) {
    aplicarLocal();
    render();
    estado.enCurso++;
    cola = cola.then(function () { return api(accion, datos); }).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      estado.ultimo = r;
    }).catch(function (e) {
      estado.huboError = true;
      if (e.message !== 'sesion') aviso('No se guardó: ' + (e.message === 'red' ? 'sin conexión' : e.message), true);
    }).then(function () {
      estado.enCurso--;
      if (estado.enCurso) return;
      var error = estado.huboError, ultimo = estado.ultimo;
      estado.huboError = false;
      estado.ultimo = null;
      if (error) { cargar(); return; }
      if (ultimo) recibir(ultimo);
      render();
    });
  }

  function clasificar(ids, categoria, extra) {
    var antes = ids.map(function (id) { var m = porId(id); return { id: id, categoria: m.categoria, origen: m.origen }; });
    var yo = estado.datos.usuario.nombre;
    enviar('clasificar', Object.assign({ ids: ids, categoria: categoria }, extra || {}), function () {
      ids.forEach(function (id) {
        var m = porId(id);
        m.categoria = categoria;
        m.origen = categoria === SIN ? SIN : 'Manual';
        m.porQuien = categoria === SIN ? '' : yo;
        m.clasificadoEn = categoria === SIN ? '' : new Date().toISOString();
        if (extra && extra.nota !== undefined) m.nota = extra.nota;
      });
    });
    if (categoria === SIN) return;
    aviso(plural(ids.length, 'movimiento', 'movimientos') + ' en ' + categoria + '.', false, function () {
      // Deshacer: los que estaban pendientes vuelven a la bandeja; los demás, a su categoría anterior
      var pend = antes.filter(function (a) { return a.origen === SIN; }).map(function (a) { return a.id; });
      if (pend.length) clasificar(pend, SIN);
      antes.filter(function (a) { return a.origen !== SIN; }).forEach(function (a) {
        enviar('clasificar', { ids: [a.id], categoria: a.categoria }, function () { var m = porId(a.id); m.categoria = a.categoria; m.origen = 'Manual'; });
      });
    });
  }

  function salir(mensaje) {
    estado.token = null;
    estado.datos = null;
    estado.error = mensaje || '';
    guardar(CLAVE_SESION, null);
    guardar(CLAVE_DATOS, null);
    try { if (window.google) google.accounts.id.disableAutoSelect(); } catch (e) { /* nada */ }
    location.hash = '';
    renderLogin();
  }

  /* ---------- inicio de sesión ---------- */
  function renderLogin() {
    document.title = NOMBRE + ' · Entrar';
    app.innerHTML =
      '<section class="login">' +
      '<img class="login-logo" src="icons/icon.svg" alt="">' +
      '<h1>' + esc(NOMBRE) + '</h1>' +
      '<p>Entra con tu cuenta de Google. Solo pueden entrar las personas autorizadas.</p>' +
      '<div id="google-btn" class="google-btn"></div>' +
      (estado.error ? '<p class="error" role="alert">' + esc(estado.error) + '</p>' : '') +
      '<p class="nota"><a href="privacidad.html">Política de privacidad</a></p>' +
      '</section>';
    if (!cfg.googleClientId) {
      document.getElementById('google-btn').innerHTML = '<p class="error">Falta configurar el acceso con Google (config.js).</p>';
      return;
    }
    cargarScript('https://accounts.google.com/gsi/client').then(function () {
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: alEntrar, auto_select: true, ux_mode: 'popup' });
      google.accounts.id.renderButton(document.getElementById('google-btn'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es', width: 280 });
    }).catch(function () { estado.error = 'No se pudo cargar el acceso de Google. Revisa tu conexión.'; renderLogin(); });
  }

  function alEntrar(resp) {
    estado.error = '';
    app.innerHTML = '<p class="cargando">Entrando…</p>';
    api('entrar', { credential: resp.credential }).then(function (r) {
      if (!r.ok) { estado.error = r.error; renderLogin(); return; }
      estado.token = r.token;
      guardar(CLAVE_SESION, r.token);
      cargar();
    }).catch(function () { estado.error = 'No se pudo conectar. Intenta de nuevo.'; renderLogin(); });
  }

  function cargarScript(src) {
    return new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = mal; document.head.appendChild(s);
    });
  }

  /* ---------- vistas ---------- */
  // Rutas por hash: #bandeja (por defecto), #movimientos, #mas.
  function ruta() { return location.hash.replace(/^#\/?/, '') || 'mes'; }

  function render() {
    if (!estado.datos) {
      app.innerHTML = estado.sinConexion
        ? '<p class="cargando">No se pudo cargar. Revisa tu conexión e intenta de nuevo.</p>'
        : '<p class="cargando">Cargando…</p>';
      return;
    }
    var r = ruta(), cuerpo;
    elegirMes();
    try {
      if (r === 'movimientos') cuerpo = vistaMovimientos();
      else if (r === 'mes') cuerpo = vistaMes();
      else if (r === 'mas') cuerpo = vistaMas();
      else cuerpo = vistaBandeja();
      app.innerHTML = cuerpo + navegacion(r);
      if (r === 'movimientos') pintarLista();
    } catch (e) {
      // Que un error en una pantalla no deje la app pegada en "Cargando…"
      console.error(e);
      app.innerHTML = cabecera(NOMBRE) + '<main><p class="error">No se pudo mostrar esta pantalla: ' + esc(e.message) + '</p>' +
        '<p class="nota">Toca ↻ arriba para volver a cargar.</p></main>' + navegacion(r);
    }
  }

  function cabecera(titulo) {
    var ocupado = estado.enCurso ? 'Guardando…' : estado.cargando ? 'Actualizando…' : '';
    return '<header class="cabecera"><img class="logo" src="icons/icon.svg" alt="">' +
      '<h1>' + esc(titulo) + '</h1>' +
      '<span class="estado-red" aria-live="polite">' + esc(ocupado) + '</span>' +
      '<button type="button" class="refrescar" data-accion="refrescar" aria-label="Actualizar">↻</button></header>';
  }

  var ICONOS = {
    mes: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
    bandeja: '<path d="M4 13h4l2 3h4l2-3h4M5 5h14l1 8v6H4v-6z"/>',
    movimientos: '<path d="M5 6h14M5 12h14M5 18h9"/>',
    mas: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'
  };
  function navegacion(actual) {
    var n = pendientes().length;
    function item(r, texto, badge) {
      return '<a href="#' + r + '" class="' + (actual === r ? 'activo' : '') + '"' + (actual === r ? ' aria-current="page"' : '') + '>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONOS[r] + '</svg><span>' + texto + '</span>' +
        (badge ? '<b class="insignia">' + badge + '</b>' : '') + '</a>';
    }
    return '<nav class="navegacion">' + item('mes', 'Mes') + item('bandeja', 'Bandeja', n) + item('movimientos', 'Movimientos') + item('mas', 'Más') + '</nav>';
  }

  function chips(ids, actual, sugerida) {
    var c = estado.datos.categorias, idsTxt = esc(ids.join(','));
    function chip(cat, clase) {
      return '<button type="button" class="chip ' + clase + (cat === actual ? ' actual' : '') + (cat === sugerida ? ' sugerida' : '') + '" style="--cat:' + colorCat(cat) + '" data-accion="clasificar" data-ids="' + idsTxt + '" data-cat="' + esc(cat) + '">' +
        (cat === sugerida ? '✓ ' : '') + esc(cat) + '</button>';
    }
    var lista = c.presupuesto.map(function (x) { return chip(x, ''); }).concat(c.especiales.map(function (x) { return chip(x, 'especial'); }));
    if (sugerida && categorias().indexOf(sugerida) >= 0) {
      var i = categorias().indexOf(sugerida);
      lista.unshift(lista.splice(i, 1)[0]);
    }
    return '<div class="chips">' + lista.join('') + '</div>';
  }

  /* ----- Bandeja: lo que falta clasificar y lo clasificado solo ----- */
  function vistaBandeja() {
    document.title = 'Bandeja · ' + NOMBRE;
    var pend = pendientes();
    var grupos = [], porClave = {};
    pend.forEach(function (m) {
      var clave = m.transferencia || !m.huella || estado.separados[m.huella] ? 'id:' + m.id : 'h:' + m.huella;
      if (!porClave[clave]) { porClave[clave] = []; grupos.push(porClave[clave]); }
      porClave[clave].push(m);
    });
    var autos = movimientos().filter(function (m) { return m.origen === 'Auto'; });

    var h = cabecera(estado.datos.nombreApp || NOMBRE) + '<main>';
    if (eventoInstalar) h += '<button type="button" class="boton secundario" data-accion="instalar">Instalar en este teléfono</button>';
    if (!pend.length) {
      h += '<section class="al-dia"><span aria-hidden="true">✓</span><h2>Todo clasificado</h2><p>Cuando lleguen movimientos nuevos del banco aparecerán aquí.</p></section>';
    } else {
      h += '<p class="resumen"><b>' + plural(pend.length, 'movimiento', 'movimientos') + '</b> por clasificar. Toca la categoría; lo marcado con ✓ es la sugerencia.</p>';
      grupos.forEach(function (g) { h += tarjetaPendiente(g); });
    }
    if (autos.length) h += seccionAutos(autos);
    h += seccionRecientes();
    if (estado.sinConexion) h += '<p class="nota">Sin conexión: se muestra lo último guardado.</p>';
    return h + '</main>';
  }

  function tarjetaPendiente(g) {
    var m = g[0], ids = g.map(function (x) { return x.id; });
    var total = g.reduce(function (s, x) { return s + (x.moneda === m.moneda ? x.monto : 0); }, 0);
    var h = '<article class="tarjeta mov" data-ids="' + esc(ids.join(',')) + '">' +
      '<div class="mov-cab"><span>' + esc(cuentaCorta(m.cuenta)) + ' · ' + esc(fechaCorta(m.fecha)) + '</span>' +
      '<span class="monto ' + claseMonto(m) + '">' + esc(dinero(m.monto, m.moneda)) + '</span></div>' +
      '<h2 class="glosa">' + esc(m.glosa) + '</h2>';
    if (g.length > 1) {
      h += '<p class="grupo">' + plural(g.length, 'movimiento', 'movimientos') + ' del mismo comercio (' +
        esc(g.map(function (x) { return fechaCorta(x.fecha); }).join(', ')) + ') · total ' + esc(dinero(total, m.moneda)) +
        ' · <button type="button" class="enlace" data-accion="separar" data-huella="' + esc(m.huella) + '">clasificar por separado</button></p>';
    }
    if (m.nota) h += '<p class="nota-mov">' + esc(m.nota) + '</p>';
    if (m.sugerencia) h += '<p class="sugerencia">Sugerencia: <b>' + esc(m.sugerencia) + '</b> · ' + esc(m.motivo) + '</p>';
    h += chips(ids, '', m.sugerencia);
    if (m.transferencia) h += '<label class="recordar"><input type="checkbox" name="recordar"> Recordar este destinatario (la próxima vez se clasifica solo)</label>';
    if (g.length === 1) h += '<details class="agregar-nota"><summary>Agregar nota</summary><input type="text" name="nota" maxlength="500" placeholder="Ej.: regalo de cumpleaños" value="' + esc(m.nota) + '"></details>';
    return h + '</article>';
  }

  function seccionAutos(autos) {
    var mostrar = estado.verTodasAutos ? autos : autos.slice(0, MAX_AUTOS);
    var h = '<h2 class="titulo-seccion">Clasificados solos · revísalos</h2><ul class="lista autos">';
    mostrar.forEach(function (m) { h += filaMovimiento(m, true); });
    h += '</ul>';
    if (autos.length > mostrar.length) h += '<button type="button" class="enlace centrado" data-accion="ver-autos">Ver los ' + autos.length + '</button>';
    h += '<button type="button" class="boton secundario" data-accion="confirmar" data-ids="' + esc(mostrar.map(function (m) { return m.id; }).join(',')) + '">Están bien: marcar ' + plural(mostrar.length, 'revisado', 'revisados') + '</button>';
    return h;
  }

  /** Lo último clasificado a mano (por cualquiera de los dos), para corregir un toque equivocado. */
  function seccionRecientes() {
    var cuando = function (m) { return m.clasificadoEn || m.fechaClasif || ''; };
    var recientes = movimientos().filter(function (m) { return m.origen === 'Manual' && cuando(m) && !/\(revisó\)$/.test(m.porQuien); })
      .sort(function (a, b) { return cuando(a) < cuando(b) ? 1 : cuando(a) > cuando(b) ? -1 : 0; })
      .slice(0, MAX_RECIENTES);
    if (!recientes.length) return '';
    var h = '<h2 class="titulo-seccion">Lo último que clasificaron · toca para corregir</h2><ul class="lista">';
    recientes.forEach(function (m) { h += filaMovimiento(m, false, true); });
    return h + '</ul>';
  }

  /** Una fila de lista; al tocarla se abre el editor (categoría, nota, recordar). */
  function filaMovimiento(m, conMotivo, conQuien) {
    var abierto = estado.abierto === m.id;
    var sub = [cuentaCorta(m.cuenta), fechaCorta(m.fecha)];
    if (conMotivo && m.motivo) sub.push(m.motivo);
    if (conQuien && m.porQuien) sub.push(primerNombre(m.porQuien));
    var h = '<li class="' + (abierto ? 'abierto' : '') + '"><button type="button" class="fila" data-accion="abrir" data-id="' + esc(m.id) + '" aria-expanded="' + abierto + '">' +
      '<span class="fila-texto"><span class="glosa">' + esc(m.glosa) + '</span><span class="sub">' + esc(sub.join(' · ')) + '</span></span>' +
      '<span class="fila-der"><span class="monto ' + claseMonto(m) + '">' + esc(dinero(m.monto, m.moneda)) + '</span>' +
      '<span class="cat" style="--cat:' + colorCat(m.categoria) + '">' + esc(m.categoria) + (m.origen === 'Auto' ? ' · auto' : '') + '</span></span></button>';
    if (abierto) h += editor(m);
    return h + '</li>';
  }

  function editor(m) {
    var info = m.origen === SIN ? 'Sin clasificar' + (m.motivo ? ' · sugerencia: ' + m.sugerencia + ' (' + m.motivo + ')' : '')
      : m.origen === 'Auto' ? 'Clasificado solo · ' + m.motivo
        : 'Clasificado por ' + (m.porQuien || '¿?') + (m.fechaClasif ? ' el ' + fechaCorta(m.fechaClasif) : '');
    return '<div class="editor" data-ids="' + esc(m.id) + '"><p class="sub">' + esc(info) + '</p>' +
      chips([m.id], m.origen === SIN ? '' : m.categoria, m.origen === SIN ? m.sugerencia : '') +
      (m.transferencia ? '<label class="recordar"><input type="checkbox" name="recordar"> Recordar este destinatario</label>' : '') +
      '<div class="nota-fila"><input type="text" name="nota" maxlength="500" placeholder="Nota" value="' + esc(m.nota) + '">' +
      '<button type="button" class="boton secundario chico" data-accion="nota" data-id="' + esc(m.id) + '">Guardar nota</button></div></div>';
  }

  /* ----- Movimientos del mes, con filtros ----- */
  function selectorMes() {
    var mes = estado.mes, primero = mesDe(estado.datos.desde), ultimo = mesDe(new Date().toISOString());
    return '<div class="selector-mes"><button type="button" data-accion="mes" data-delta="-1" aria-label="Mes anterior"' + (mes <= primero ? ' disabled' : '') + '>‹</button>' +
      '<h2>' + esc(nombreMes(mes)) + '</h2>' +
      '<button type="button" data-accion="mes" data-delta="1" aria-label="Mes siguiente"' + (mes >= ultimo ? ' disabled' : '') + '>›</button></div>';
  }

  /* ----- Mes: gastado de verdad contra el presupuesto ----- */

  /**
   * Cuentas del mes, igual que la hoja Resumen: Presupuesto (fila del mes o Default), Gastado
   * (pesos de la categoría, neto de devoluciones, + US$ x tipo de cambio si lo hay), Pendiente
   * (compromisos de la hoja Pendientes) y Remanente. Pago tarjeta y Abono no son gasto.
   */
  function resumenMes(ym) {
    var d = estado.datos, pres = d.presupuesto || { porDefecto: {}, meses: {} }, pend = (d.pendientes || {})[ym] || {};
    var tc = d.tipoCambio || 0, delMes = movimientos().filter(function (m) { return mesDe(m.fecha) === ym; });
    var r = { categorias: [], presupuesto: 0, gastado: 0, pendiente: 0, usdSinConvertir: 0, ingresos: 0, sinClasificar: 0, nSinClasificar: 0 };
    d.categorias.presupuesto.forEach(function (cat) {
      var delMesCat = (pres.meses[ym] || {})[cat];
      var c = { nombre: cat, presupuesto: delMesCat !== undefined ? delMesCat : (pres.porDefecto[cat] || 0), gastado: 0, usd: 0, pendiente: pend[cat] || 0 };
      delMes.forEach(function (m) {
        if (m.categoria !== cat) return;
        if (m.moneda === 'USD') c.usd -= m.monto; else c.gastado -= m.monto;
      });
      if (tc) c.gastado += c.usd * tc; else r.usdSinConvertir += c.usd;
      c.remanente = c.presupuesto - c.gastado - c.pendiente;
      r.presupuesto += c.presupuesto; r.gastado += c.gastado; r.pendiente += c.pendiente;
      if (c.presupuesto || c.gastado || c.usd || c.pendiente) r.categorias.push(c);
    });
    delMes.forEach(function (m) {
      if (m.categoria === SIN) r.nSinClasificar++;
      if (m.moneda === 'USD') return;
      if (m.categoria === 'Abono') r.ingresos += m.monto;
      if (m.categoria === SIN) r.sinClasificar -= m.monto;
    });
    r.remanente = r.presupuesto - r.gastado - r.pendiente;
    return r;
  }

  function barra(usado, total, color, marca) {
    var pct = total > 0 ? Math.min(usado / total, 1) * 100 : (usado > 0 ? 100 : 0);
    var pasado = total > 0 ? usado > total : usado > 0;
    return '<div class="barra' + (pasado ? ' pasada' : '') + '" role="img" aria-label="' + (total > 0 ? Math.round(usado / total * 100) + ' % usado' : '') + '">' +
      '<span style="width:' + pct.toFixed(1) + '%;' + (color && !pasado ? 'background:' + color : '') + '"></span>' +
      (marca !== undefined ? '<i style="left:' + (marca * 100).toFixed(1) + '%" title="Hoy"></i>' : '') + '</div>';
  }

  /** Lo que hay hoy en el banco (pestaña Saldos, la llena el scraper al entrar a BICE). */
  function tarjetaSaldos() {
    var saldos = estado.datos.saldos || [];
    var buscar = function (concepto) { return saldos.filter(function (x) { return x.concepto === concepto; })[0]; };
    var enCuenta = buscar('Saldo en cuenta'), disponible = buscar('Total disponible');
    if (!enCuenta && !disponible) return '';
    var principal = enCuenta || disponible;
    var d = new Date(principal.leidoEn), hoy = new Date();
    var hora = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    var cuando = d.toDateString() === hoy.toDateString() ? 'hoy ' + hora : d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3) + ' ' + hora;
    return '<section class="tarjeta resumen-mes saldos"><p class="sub">En la cuenta corriente</p>' +
      '<p class="grande">' + esc(dinero(principal.monto)) + '</p>' +
      (enCuenta && disponible && disponible.monto !== enCuenta.monto ? '<p class="sub">Total disponible ' + esc(dinero(disponible.monto)) + '</p>' : '') +
      '<p class="sub">Leído en BICE ' + esc(cuando) + '. La deuda de la tarjeta aparecerá aquí cuando aprenda a leerla.</p></section>';
  }

  function vistaMes() {
    document.title = 'Mes · ' + NOMBRE;
    var ym = estado.mes, r = resumenMes(ym);
    var hoy = new Date(), esActual = ym === mesDe(hoy.toISOString());
    var diasMes = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
    var avance = esActual ? hoy.getDate() / diasMes : undefined;
    var h = cabecera('Mes') + '<main>' + selectorMes();
    if (esActual) h += tarjetaSaldos();

    var usadoPct = r.presupuesto ? Math.round(r.gastado / r.presupuesto * 100) : 0;
    h += '<section class="tarjeta resumen-mes"><p class="sub">Gastado de verdad</p>' +
      '<p class="grande">' + esc(dinero(r.gastado)) + '</p>' +
      (r.presupuesto ? '<p class="sub">de ' + esc(dinero(r.presupuesto)) + ' presupuestados · ' + usadoPct + ' %</p>' + barra(r.gastado + r.pendiente, r.presupuesto, '', avance) : '<p class="sub">Aún no hay presupuesto para este mes.</p>') +
      (r.presupuesto ? '<p class="' + (r.remanente < 0 ? 'alerta' : 'queda') + '">' + (r.remanente < 0 ? 'Te pasaste ' + esc(dinero(-r.remanente)) : 'Te quedan ' + esc(dinero(r.remanente))) + '</p>' : '') +
      (esActual ? '<p class="sub">Vamos en el día ' + hoy.getDate() + ' de ' + diasMes + ' (' + Math.round(avance * 100) + ' % del mes). La rayita de la barra es hoy.</p>' : '') +
      (r.pendiente ? '<p class="sub">Incluye ' + esc(dinero(r.pendiente)) + ' comprometidos que aún no se cobran.</p>' : '') +
      '</section>';

    if (r.nSinClasificar) h += '<a class="tarjeta aviso-pendiente" href="#bandeja"><b>' + plural(r.nSinClasificar, 'movimiento', 'movimientos') + ' sin clasificar</b> (' + esc(dinero(r.sinClasificar)) + ') no se cuentan todavía. Clasificar ›</a>';

    h += '<h2 class="titulo-seccion">Por categoría</h2><ul class="lista categorias-mes">';
    r.categorias.sort(function (a, b) { return (b.presupuesto ? (b.gastado + b.pendiente) / b.presupuesto : 9) - (a.presupuesto ? (a.gastado + a.pendiente) / a.presupuesto : 9); });
    r.categorias.forEach(function (c) {
      var usado = c.gastado + c.pendiente, color = colorCat(c.nombre);
      var detalle = c.presupuesto
        ? (c.remanente < 0 ? '<span class="alerta">Pasado ' + esc(dinero(-c.remanente)) + '</span>' : 'Quedan ' + esc(dinero(c.remanente)))
        : 'Sin presupuesto';
      h += '<li><button type="button" class="fila-cat" data-accion="ver-categoria" data-cat="' + esc(c.nombre) + '">' +
        '<span class="fila-cat-cab"><span class="nombre-cat" style="--cat:' + color + '">' + esc(c.nombre) + '</span>' +
        '<span class="monto-cat">' + esc(dinero(c.gastado)) + (c.presupuesto ? ' <span class="sub">de ' + esc(dinero(c.presupuesto)) + '</span>' : '') + '</span></span>' +
        barra(usado, c.presupuesto, color) +
        '<span class="sub fila-cat-pie">' + detalle + (c.pendiente ? ' · ' + esc(dinero(c.pendiente)) + ' comprometido' : '') + (c.usd && !estado.datos.tipoCambio ? ' · + ' + esc(dinero(c.usd, 'USD')) : '') + '</span>' +
        '</button></li>';
    });
    h += '</ul>';

    h += '<div class="totales"><div><span>Ingresos del mes</span><b>' + esc(dinero(r.ingresos)) + '</b></div>' +
      (r.usdSinConvertir ? '<div><span>Compras en dólares</span><b>' + esc(dinero(r.usdSinConvertir, 'USD')) + '</b></div>' : '') + '</div>';
    if (r.usdSinConvertir) h += '<p class="nota">Las compras en dólares no se suman al presupuesto mientras no haya un tipo de cambio (App_Ajustes ▸ tipoCambio).</p>';
    h += '<p class="nota">Los pagos de la tarjeta no son gasto: el gasto ya se contó en cada compra.</p>';
    return h + '</main>';
  }

  function vistaMovimientos() {
    document.title = 'Movimientos · ' + NOMBRE;
    var cuentas = [];
    movimientos().forEach(function (m) { if (cuentas.indexOf(m.cuenta) < 0) cuentas.push(m.cuenta); });
    function opcion(v, texto, actual) { return '<option value="' + esc(v) + '"' + (v === actual ? ' selected' : '') + '>' + esc(texto) + '</option>'; }
    return cabecera('Movimientos') + '<main>' + selectorMes() +
      '<div class="totales" id="totales"></div>' +
      '<div class="filtros">' +
      '<select id="filtro-cat" aria-label="Categoría">' + opcion('', 'Todas las categorías', estado.filtroCat) + opcion(SIN, SIN, estado.filtroCat) +
      categorias().map(function (c) { return opcion(c, c, estado.filtroCat); }).join('') + '</select>' +
      '<select id="filtro-cuenta" aria-label="Cuenta">' + opcion('', 'Todas las cuentas', estado.filtroCuenta) +
      cuentas.map(function (c) { return opcion(c, cuentaCorta(c), estado.filtroCuenta); }).join('') + '</select>' +
      '<input type="search" id="busqueda" placeholder="Buscar glosa o nota" value="' + esc(estado.busqueda) + '"></div>' +
      '<div id="lista"></div></main>';
  }

  /** Solo la lista y los totales: se repinta al escribir en la búsqueda sin perder el foco. */
  function pintarLista() {
    var b = norm(estado.busqueda), cats = estado.datos.categorias.presupuesto;
    var delMes = movimientos().filter(function (m) { return mesDe(m.fecha) === estado.mes; });
    var lista = delMes.filter(function (m) {
      return (!estado.filtroCat || m.categoria === estado.filtroCat) &&
        (!estado.filtroCuenta || m.cuenta === estado.filtroCuenta) &&
        (!b || norm(m.glosa + ' ' + m.nota).indexOf(b) >= 0);
    });
    // Gastado = neto de las categorías de presupuesto, en pesos (como la hoja Resumen)
    var gastado = 0, ingresos = 0, sinClasif = 0, usd = 0;
    delMes.forEach(function (m) {
      if (m.moneda === 'USD') { if (cats.indexOf(m.categoria) >= 0) usd -= m.monto; return; }
      if (cats.indexOf(m.categoria) >= 0) gastado -= m.monto;
      else if (m.categoria === 'Abono') ingresos += m.monto;
      else if (m.categoria === SIN) sinClasif += m.monto;
    });
    var t = '<div><span>Gastado</span><b>' + esc(dinero(gastado)) + '</b></div><div><span>Ingresos</span><b>' + esc(dinero(ingresos)) + '</b></div>';
    if (sinClasif) t += '<div><span>Sin clasificar</span><b>' + esc(dinero(sinClasif)) + '</b></div>';
    if (usd) t += '<div><span>En dólares</span><b>' + esc(dinero(usd, 'USD')) + '</b></div>';
    document.getElementById('totales').innerHTML = t;

    var h = '';
    if (!lista.length) h = '<p class="nota">' + (delMes.length ? 'Nada calza con el filtro.' : 'No hay movimientos este mes.') + '</p>';
    var dia = null;
    lista.forEach(function (m) {
      if (m.fecha !== dia) {
        if (dia !== null) h += '</ul>';
        dia = m.fecha;
        h += '<h3 class="dia">' + esc(fechaDia(m.fecha)) + '</h3><ul class="lista">';
      }
      h += filaMovimiento(m, m.origen === 'Auto');
    });
    if (dia !== null) h += '</ul>';
    if (lista.length && (estado.filtroCat || estado.filtroCuenta || b)) {
      var suma = lista.reduce(function (s, m) { return s + (m.moneda === 'USD' ? 0 : m.monto); }, 0);
      h += '<p class="nota">' + plural(lista.length, 'movimiento', 'movimientos') + ' · suma ' + esc(dinero(suma)) + '</p>';
    }
    document.getElementById('lista').innerHTML = h;
  }

  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

  /* ----- Más: aprendizaje, cuenta y enlaces ----- */
  function vistaMas() {
    document.title = 'Más · ' + NOMBRE;
    var d = estado.datos, u = d.usuario || {}, ev = d.modelo || {};
    var movs = movimientos(), mes = mesDe(new Date().toISOString());
    var delMes = movs.filter(function (m) { return mesDe(m.fecha) === mes && m.origen !== SIN; });
    var solos = delMes.filter(function (m) { return m.origen === 'Auto' || /revisó/.test(m.porQuien); }).length;
    var h = cabecera('Más') + '<main>' +
      '<p class="saludo">Hola, ' + esc(primerNombre(u.nombre)) + ' <span class="sub">(' + esc(u.correo) + ')</span></p>' +
      '<article class="tarjeta"><h2>Cómo va el aprendizaje</h2>' +
      '<p>' + plural(ev.ejemplos || 0, 'clasificación confirmada', 'clasificaciones confirmadas') + ' le enseñan al clasificador.</p>' +
      (ev.ejemplos ? '<p>Probado con sus propios datos, el modelo acierta el <b>' + Math.round((ev.acierto || 0) * 100) + ' %</b> de las veces.</p>' : '') +
      '<p>' + (ev.confiable
        ? 'Ya demostró ser confiable: clasifica solo cuando está seguro (y ustedes lo revisan en la bandeja).'
        : 'Por ahora el modelo solo sugiere. Clasificará solo cuando tenga al menos 30 ejemplos y acierte 95 % en los casos en que está seguro.') + '</p>' +
      '<p>Lo que ya clasificaron 2 veces igual (mismo comercio) o calza con una regla se clasifica solo desde ya.</p>' +
      (delMes.length ? '<p>Este mes: ' + plural(solos, 'movimiento clasificado', 'movimientos clasificados') + ' solo de ' + delMes.length + '.</p>' : '') +
      '</article>' +
      (eventoInstalar ? '<button type="button" class="boton secundario" data-accion="instalar">Instalar en este teléfono</button>' : '') +
      '<ul class="lista enlaces">' +
      (d.planilla ? '<li><a href="' + esc(d.planilla) + '" target="_blank" rel="noopener">Abrir la planilla</a></li>' : '') +
      '<li><a href="privacidad.html">Privacidad</a></li>' +
      '<li><button type="button" class="enlace" data-accion="salir">Salir de esta cuenta</button></li></ul>' +
      '<p class="version">Versión ' + VERSION_APP + (DEMO ? ' · demo' : '') + '</p>';
    return h + '</main>';
  }

  /* ---------- eventos (delegados) ---------- */
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-accion]');
    if (!b) return;
    var accion = b.getAttribute('data-accion');
    if (accion === 'clasificar') {
      var caja = b.closest('[data-ids]');
      var extra = {}, rec = caja && caja.querySelector('input[name=recordar]'), nota = caja && caja.querySelector('input[name=nota]');
      if (rec && rec.checked) extra.recordar = true;
      var ids = b.getAttribute('data-ids').split(',');
      if (nota && ids.length === 1 && nota.value !== (porId(ids[0]).nota || '')) extra.nota = nota.value.trim();
      estado.abierto = null;
      clasificar(ids, b.getAttribute('data-cat'), extra);
    } else if (accion === 'confirmar') {
      var lista = b.getAttribute('data-ids').split(',').filter(Boolean);
      var yo = estado.datos.usuario.nombre;
      enviar('confirmar', { ids: lista }, function () {
        lista.forEach(function (id) { var m = porId(id); if (m && m.origen === 'Auto') { m.origen = 'Manual'; m.porQuien = yo + ' (revisó)'; } });
      });
      aviso(plural(lista.length, 'movimiento revisado', 'movimientos revisados') + '. Gracias: eso también enseña.');
    } else if (accion === 'nota') {
      var id = b.getAttribute('data-id'), input = b.parentNode.querySelector('input[name=nota]');
      var texto = input.value.trim();
      enviar('nota', { ids: [id], nota: texto }, function () { porId(id).nota = texto; });
      aviso('Nota guardada.');
    } else if (accion === 'abrir') {
      var idA = b.getAttribute('data-id');
      estado.abierto = estado.abierto === idA ? null : idA;
      render();
    } else if (accion === 'separar') {
      estado.separados[b.getAttribute('data-huella')] = true;
      render();
    } else if (accion === 'ver-autos') {
      estado.verTodasAutos = true;
      render();
    } else if (accion === 'mes') {
      estado.mes = mesMas(estado.mes, +b.getAttribute('data-delta'));
      estado.abierto = null;
      render();
    } else if (accion === 'ver-categoria') {
      estado.filtroCat = b.getAttribute('data-cat');
      estado.filtroCuenta = '';
      estado.busqueda = '';
      location.hash = '#movimientos';
    } else if (accion === 'refrescar') {
      cargar();
    } else if (accion === 'instalar') {
      eventoInstalar.prompt();
      eventoInstalar = null;
      render();
    } else if (accion === 'salir') {
      salir();
    }
  });
  app.addEventListener('change', function (e) {
    if (e.target.id === 'filtro-cat') { estado.filtroCat = e.target.value; pintarLista(); }
    if (e.target.id === 'filtro-cuenta') { estado.filtroCuenta = e.target.value; pintarLista(); }
  });
  app.addEventListener('input', function (e) {
    if (e.target.id === 'busqueda') { estado.busqueda = e.target.value; pintarLista(); }
  });

  /* ---------- avisos breves en pantalla (con "Deshacer" opcional) ---------- */
  function aviso(texto, esError, alDeshacer) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.className = 'toast' + (esError ? ' error' : '');
    t.innerHTML = '<span>' + esc(texto) + '</span>' + (alDeshacer ? '<button type="button">Deshacer</button>' : '');
    if (alDeshacer) t.querySelector('button').onclick = function () { t.className = 'toast oculto'; alDeshacer(); };
    clearTimeout(aviso.t);
    aviso.t = setTimeout(function () { t.className = 'toast oculto'; }, alDeshacer ? 6000 : 4000);
  }

  /* ---------- modo demo (?demo, o sin apiUrl): datos inventados de dev-data.json, nada se envía ---------- */
  function demoApi(accion, p) {
    // El cambio ya se aplicó en pantalla. Se imita el aprendizaje: 2 decisiones iguales en un comercio lo clasifican solo.
    if (accion === 'clasificar' && p.categoria !== SIN) {
      var movs = movimientos();
      pendientes().forEach(function (m) {
        if (m.transferencia || !m.huella) return;
        var iguales = movs.filter(function (x) { return x.huella === m.huella && x.origen === 'Manual'; });
        if (iguales.length >= 2 && iguales.every(function (x) { return x.categoria === iguales[0].categoria; })) {
          m.categoria = iguales[0].categoria; m.origen = 'Auto'; m.motivo = 'Ya lo clasificaron ' + iguales.length + ' veces así';
        }
      });
    }
    return new Promise(function (ok) { setTimeout(function () { ok(JSON.parse(JSON.stringify(estado.datos))); }, 400); });
  }

  /* ---------- arranque ---------- */
  window.addEventListener('hashchange', function () { estado.abierto = null; render(); window.scrollTo(0, 0); });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); eventoInstalar = e; if (estado.datos) render(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && (estado.token || DEMO) && !DEMO) cargar(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* sin modo offline */ });
  }
  estado.token = leer(CLAVE_SESION);
  cargar();
})();
