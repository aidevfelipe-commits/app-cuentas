// Pruebas del servidor (apps-script/) contra una planilla simulada en memoria, con datos
// inventados. No reemplazan probar en Google: los servicios de Apps Script están imitados.
// Correr con: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

/* ---------- imitación mínima de los servicios de Apps Script ---------- */

function crearHoja(nombre, filas) {
  const h = {
    nombre, datos: filas.map(f => f.slice()), maxCols: Math.max(26, ...filas.map(f => f.length)),
    getName: () => nombre,
    getLastRow: () => { for (let i = h.datos.length - 1; i >= 0; i--) if (h.datos[i].some(v => v !== '' && v != null)) return i + 1; return 0; },
    getLastColumn: () => { let m = 0; h.datos.forEach(f => f.forEach((v, c) => { if (v !== '' && v != null) m = Math.max(m, c + 1); })); return m; },
    getMaxColumns: () => h.maxCols,
    getMaxRows: () => Math.max(1000, h.datos.length),
    insertColumnsAfter: (_, n) => { h.maxCols += n; },
    getRange: (r, c, nr = 1, nc = 1) => rango(h, r, c, nr, nc),
    getDataRange: () => rango(h, 1, 1, Math.max(1, h.getLastRow()), Math.max(1, h.getLastColumn())),
    setFrozenRows() {}, setColumnWidth() {}, setTabColor() {}
  };
  return h;
}
function rango(h, r, c, nr, nc) {
  if (c + nc - 1 > h.maxCols) throw new Error('Rango fuera de la hoja');
  const celda = (i, j) => { const f = h.datos[r - 1 + i]; return f && f[c - 1 + j] !== undefined ? f[c - 1 + j] : ''; };
  const poner = (i, j, v) => { while (h.datos.length < r + i) h.datos.push([]); const f = h.datos[r - 1 + i]; while (f.length < c + j) f.push(''); f[c - 1 + j] = v; };
  const self = {
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => celda(i, j))),
    setValues: (vals) => { vals.forEach((f, i) => f.forEach((v, j) => poner(i, j, v))); return self; },
    setValue: (v) => { poner(0, 0, v); return self; },
    setFontWeight: () => self, setBackground: () => self, setFontColor: () => self, setNumberFormat: () => self, setDataValidation: () => self
  };
  return self;
}

function crearEntorno(hojasIniciales, opciones = {}) {
  const hojas = {};
  Object.keys(hojasIniciales).forEach(n => { hojas[n] = crearHoja(n, hojasIniciales[n]); });
  const props = {};
  const alertas = [], copias = [];
  const ss = {
    getSheetByName: n => hojas[n] || null,
    insertSheet: n => (hojas[n] = crearHoja(n, [])),
    deleteSheet: () => {},
    getId: () => 'planilla-1', getName: () => 'Control de Gastos', getUrl: () => 'https://docs.google.com/spreadsheets/d/planilla-1',
    toast: () => {}
  };
  const carpeta = { id: 'carpeta-1', archivos: [], getId: () => 'carpeta-1', isTrashed: () => false, getFiles: () => { let i = 0; const a = carpeta.archivos.filter(f => !f.papelera); return { hasNext: () => i < a.length, next: () => a[i++] }; } };
  const encadenar = () => { const o = new Proxy({}, { get: (_, k) => (k === 'build' ? () => ({}) : () => o) }); return o; };
  const ctx = {
    console: { log: console.log, error: () => {} },  // los errores esperados no ensucian la salida
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, openById: () => ss, flush: () => {},
      newDataValidation: encadenar,
      getUi: () => ({ alert: (...a) => alertas.push(a), ButtonSet: { OK: 'OK' }, createMenu: encadenar }),
      getActive: () => ss
    },
    Session: { getScriptTimeZone: () => 'America/Santiago', getEffectiveUser: () => ({ getEmail: () => 'dueno@example.com' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: encadenar, getService: () => ({ getUrl: () => 'https://script.google.com/x/exec' }) },
    DriveApp: {
      createFolder: () => carpeta, getFolderById: () => carpeta,
      getFileById: () => ({ makeCopy: (nombre) => { const f = { nombre, creado: Date.now() + carpeta.archivos.length, getDateCreated: () => f.creado, setTrashed: v => { f.papelera = v; } }; carpeta.archivos.push(f); copias.push(nombre); return f; } })
    },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(opciones.token || {}) }) },
    ContentService: { createTextOutput: s => ({ texto: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = n => String(n).padStart(2, '0');
        return fmt.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate())).replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
      },
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: x => Buffer.from(typeof x === 'string' ? x : Buffer.from(x)).toString('base64url') + '=',
      base64DecodeWebSafe: s => Buffer.from(s, 'base64url'),
      computeHmacSha256Signature: (t, k) => crypto.createHmac('sha256', k).update(t).digest(),
      newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString('utf8') })
    }
  };
  vm.createContext(ctx);
  // Las fechas deben ser del mismo "mundo" que el código (instanceof Date)
  const FechaCtx = vm.runInContext('Date', ctx);
  Object.values(hojas).forEach(h => h.datos.forEach(f => f.forEach((v, i) => { if (v instanceof Date) f[i] = new FechaCtx(v.getTime()); })));
  const dir = path.join(__dirname, '..', 'apps-script');
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  return { ctx, hojas, alertas, copias, props };
}

/* ---------- datos inventados ---------- */

const TITULOS_MOV = ['ID', 'Fecha', 'Glosa', 'Monto', 'Moneda', 'Cuenta', 'Categoria', 'Nota', 'Origen', 'Mes', 'Fecha_Carga'];
function hoy(dias = 0) { const d = new Date(); d.setDate(d.getDate() - dias); d.setHours(12, 0, 0, 0); return d; }
function filaMov(id, dias, glosa, monto, categoria, origen, nota = '') {
  return [id, hoy(dias), glosa, monto, 'CLP', 'Tarjeta de Crédito', categoria, nota, origen, '', ''];
}
function planillaBase() {
  return {
    Movimientos: [
      TITULOS_MOV,
      filaMov('mv_1', 1, 'PANADERIA LA ESPIGA 1', -3000, 'Sin clasificar', 'Sin clasificar'),
      filaMov('mv_2', 2, 'PANADERIA LA ESPIGA 2', -3500, 'Sin clasificar', 'Sin clasificar'),
      filaMov('mv_3', 3, 'PANADERIA LA ESPIGA 3', -4000, 'Sin clasificar', 'Sin clasificar'),
      filaMov('mv_4', 4, 'SERVICENTRO NORTE 9', -30000, 'Sin clasificar', 'Sin clasificar'),
      filaMov('mv_5', 5, 'TIENDA ROPA', -20000, 'Otros', 'Sin clasificar'),        // clasificado en la planilla
      filaMov('mv_6', 6, 'Transferencia a Maria Soto', -50000, 'Sin clasificar', 'Sin clasificar'),
      filaMov('mv_7', 7, 'Transferencia a Maria Soto', -50000, 'Sin clasificar', 'Sin clasificar'),
      filaMov('mv_8', 8, 'COSA RARA', -1000, 'Sin clasificar', 'compra para el cumple'), // apunte en Origen
      filaMov('mv_9', 9, 'FARMACIA SUR', -9000, 'Comida', 'Auto')
    ],
    Reglas: [['Palabra_Clave', 'Categoria', 'Origen', 'Fecha_Creacion'], ['servicentro', 'Bencina', 'Semilla', '2026-10-01']],
    Presupuesto: [['Mi pestaña', 'no tocar'], ['x', 1]]
  };
}

function preparado(opciones) {
  const e = crearEntorno(planillaBase(), opciones);
  e.ctx.prepararPlanilla();
  return e;
}
function tabla(e, nombre) {
  const [t, ...filas] = e.hojas[nombre].datos;
  return filas.filter(f => f.some(v => v !== '')).map(f => Object.fromEntries(t.map((k, i) => [k, f[i] === undefined ? '' : f[i]])));
}
function mov(e, id) { return tabla(e, 'Movimientos').find(m => m.ID === id); }
function post(e, cuerpo) { return JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify(cuerpo) } }).texto); }

/* ---------- pruebas ---------- */

test('Preparar planilla: respalda, crea pestañas App_, agrega columnas al final y clasifica', () => {
  const e = preparado();
  assert.equal(e.copias.length, 1, 'un respaldo antes de tocar nada');
  assert.deepEqual(e.hojas.Movimientos.datos[0], TITULOS_MOV.concat(['Sugerencia', 'Confianza', 'Clasificado_Por', 'Fecha_Clasif']));
  assert.deepEqual(e.hojas.Presupuesto.datos, [['Mi pestaña', 'no tocar'], ['x', 1]]);
  const ajustes = Object.fromEntries(tabla(e, 'App_Ajustes').map(f => [f.Clave, f.Valor]));
  assert.equal(ajustes.clasificaLaApp, 'Sí');
  assert.equal(tabla(e, 'App_Personas')[0].Correo, 'dueno@example.com');
  assert.equal(mov(e, 'mv_4').Categoria, 'Bencina');
  assert.equal(mov(e, 'mv_4').Origen, 'Auto');
  assert.equal(mov(e, 'mv_5').Origen, 'Manual', 'lo elegido en la planilla queda Manual');
  assert.equal(mov(e, 'mv_5').Clasificado_Por, 'Planilla');
  assert.equal(mov(e, 'mv_1').Origen, 'Sin clasificar');
  assert.equal(mov(e, 'mv_8').Origen, 'compra para el cumple', 'un apunte en Origen no se pisa');
});

test('Preparar planilla no toca nada si ya hay una pestaña ajena con el mismo nombre', () => {
  const base = planillaBase();
  base.App_Ajustes = [['Otra cosa'], ['mía']];
  const e = crearEntorno(base);
  e.ctx.prepararPlanilla();
  assert.equal(e.alertas.length, 1);
  assert.equal(e.copias.length, 0);
  assert.deepEqual(e.hojas.App_Ajustes.datos, [['Otra cosa'], ['mía']]);
  assert.equal(e.hojas.Movimientos.datos[0].length, TITULOS_MOV.length);
});

function conSesion(correo = 'dueno@example.com') {
  const e = preparado({ token: { aud: 'cliente-1', email: correo, email_verified: 'true' } });
  const h = e.hojas.App_Ajustes;
  const fila = h.datos.findIndex(f => f[0] === 'googleClientId');
  h.datos[fila][1] = 'cliente-1';
  e.hojas.App_Personas.datos.push(['Persona Dos', 'dos@example.com', 'editor', '']);
  return e;
}

test('entrar: solo correos de App_Personas', () => {
  const e = conSesion();
  const r = post(e, { accion: 'entrar', credential: 'x' });
  assert.equal(r.ok, true);
  assert.equal(r.usuario.rol, 'admin');
  const ajeno = conSesion('intruso@example.com');
  const r2 = post(ajeno, { accion: 'entrar', credential: 'x' });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /no tiene acceso/);
  assert.equal(post(e, { accion: 'datos', token: 'falso.token' }).codigo, 'sesion');
});

function sesion(e) { return post(e, { accion: 'entrar', credential: 'x' }).token; }

test('datos: entrega pendientes con sugerencia y no entrega lo de otros a quien no es admin', () => {
  const e = conSesion();
  const d = post(e, { accion: 'datos', token: sesion(e) });
  assert.equal(d.ok, true);
  assert.ok(d.planilla.includes('docs.google.com'));
  const pend = d.movimientos.filter(m => m.origen === 'Sin clasificar').map(m => m.id).sort();
  assert.deepEqual(pend, ['mv_1', 'mv_2', 'mv_3', 'mv_6', 'mv_7', 'mv_8']);
  assert.equal(d.movimientos.find(m => m.id === 'mv_6').transferencia, true);
});

test('clasificar: aprende del comercio, ubica por ID aunque se ordene la planilla, y deshace', () => {
  const e = conSesion();
  const token = sesion(e);
  // Alguien ordena la planilla: las filas cambian de lugar
  const [t, ...filas] = e.hojas.Movimientos.datos;
  e.hojas.Movimientos.datos = [t, ...filas.reverse()];

  let d = post(e, { accion: 'clasificar', token, ids: ['mv_1', 'mv_2'], categoria: 'Comida' });
  assert.equal(d.ok, true, d.error);
  assert.equal(mov(e, 'mv_1').Categoria, 'Comida');
  assert.equal(mov(e, 'mv_1').Origen, 'Manual');
  assert.equal(mov(e, 'mv_1').Clasificado_Por, 'Administrador');
  assert.match(mov(e, 'mv_1').Fecha_Clasif, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.equal(mov(e, 'mv_3').Categoria, 'Comida', 'el tercero se clasifica solo');
  assert.equal(mov(e, 'mv_3').Origen, 'Auto');
  assert.equal(d.movimientos.find(m => m.id === 'mv_3').origen, 'Auto');
  assert.match(d.movimientos.find(m => m.id === 'mv_1').clasificadoEn, /^\d{4}-\d\d-\d\dT/, 'trae la hora para "Lo último que clasificaron"');

  d = post(e, { accion: 'clasificar', token, ids: ['mv_1'], categoria: 'Sin clasificar' });
  assert.equal(mov(e, 'mv_1').Origen, 'Sin clasificar');
  assert.equal(mov(e, 'mv_1').Fecha_Clasif, '');
});

test('clasificar: categoría inválida o ID inexistente dan error claro', () => {
  const e = conSesion();
  const token = sesion(e);
  assert.match(post(e, { accion: 'clasificar', token, ids: ['mv_1'], categoria: 'Inventada' }).error, /desconocida/);
  assert.match(post(e, { accion: 'clasificar', token, ids: ['mv_999'], categoria: 'Comida' }).error, /ya no está/);
});

test('recordar destinatario crea una regla Recordada y la siguiente transferencia se clasifica sola', () => {
  const e = conSesion();
  const token = sesion(e);
  post(e, { accion: 'clasificar', token, ids: ['mv_6'], categoria: 'Aportes', recordar: true });
  const regla = tabla(e, 'Reglas').find(r => r.Origen === 'Recordada');
  assert.equal(regla.Palabra_Clave, 'transferencia maria soto');
  assert.equal(mov(e, 'mv_7').Categoria, 'Aportes');
  assert.equal(mov(e, 'mv_7').Origen, 'Auto');
});

test('al clasificar, un apunte escrito en Origen pasa a Nota', () => {
  const e = conSesion();
  post(e, { accion: 'clasificar', token: sesion(e), ids: ['mv_8'], categoria: 'Otros' });
  assert.equal(mov(e, 'mv_8').Origen, 'Manual');
  assert.equal(mov(e, 'mv_8').Nota, 'compra para el cumple');
});

test('confirmar revisión de automáticas y guardar nota', () => {
  const e = conSesion();
  const token = post(e, { accion: 'entrar', credential: 'x' }).token;
  post(e, { accion: 'confirmar', token, ids: ['mv_4', 'mv_9'] });
  assert.equal(mov(e, 'mv_4').Origen, 'Manual');
  assert.equal(mov(e, 'mv_4').Clasificado_Por, 'Administrador (revisó)');
  assert.equal(mov(e, 'mv_9').Categoria, 'Comida');
  post(e, { accion: 'nota', token, ids: ['mv_4'], nota: 'viaje al sur' });
  assert.equal(mov(e, 'mv_4').Nota, 'viaje al sur');
});

test('la persona editora también clasifica y queda registrado su nombre', () => {
  const e = conSesion('dos@example.com');
  const r = post(e, { accion: 'entrar', credential: 'x' });
  assert.equal(r.usuario.rol, 'editor');
  const d = post(e, { accion: 'clasificar', token: r.token, ids: ['mv_1'], categoria: 'Comida' });
  assert.equal(d.planilla, '', 'el enlace a la planilla es solo para admin');
  assert.equal(mov(e, 'mv_1').Clasificado_Por, 'Persona Dos');
});

test('respaldo deja solo las copias configuradas', () => {
  const e = preparado();
  for (let i = 0; i < 35; i++) e.ctx.respaldar_('prueba');
  const carpeta = e.ctx.DriveApp.getFolderById();
  assert.equal(carpeta.archivos.filter(f => !f.papelera).length, 30);
});

test('la hora de clasificación se lee aunque la columna tenga formato de texto', () => {
  const e = conSesion();
  const token = sesion(e);
  post(e, { accion: 'clasificar', token, ids: ['mv_1'], categoria: 'Comida' });
  // Así queda una fecha escrita en una celda con formato de texto
  const [t] = e.hojas.Movimientos.datos;
  const col = t.indexOf('Fecha_Clasif');
  const fila = e.hojas.Movimientos.datos.find(f => f[0] === 'mv_1');
  fila[col] = 'Thu Oct 29 2026 12:40:00 GMT-0300 (hora de verano de Chile)';
  const d = post(e, { accion: 'datos', token });
  const m = d.movimientos.find(x => x.id === 'mv_1');
  assert.equal(m.fechaClasif, '2026-10-29');
  assert.match(m.clasificadoEn, /^2026-10-29T15:40/);
});

test('inicioControl: lo anterior no se muestra ni se pide clasificar, pero sigue enseñando', () => {
  const e = conSesion();
  const h = e.hojas.App_Ajustes;
  h.datos.find(f => f[0] === 'inicioControl')[1] = e.ctx.Utilities.formatDate(hoy(5), '', 'yyyy-MM-dd');
  const d = post(e, { accion: 'datos', token: sesion(e) });
  const ids = d.movimientos.map(m => m.id).sort();
  assert.deepEqual(ids, ['mv_1', 'mv_2', 'mv_3', 'mv_4', 'mv_5']);
  assert.equal(d.desde, e.ctx.Utilities.formatDate(hoy(5), '', 'yyyy-MM-dd'));
});

test('regla: el admin crea una regla fija y se aplica al tiro; el editor no puede', () => {
  const e = conSesion();
  const token = sesion(e);
  e.hojas.Movimientos.datos.push(filaMov('mv_20', 1, 'Cargo por abono/pago de tarjeta', -400000, 'Sin clasificar', 'Sin clasificar'));
  const d = post(e, { accion: 'regla', token, palabra: 'Pago de Tarjeta', categoria: 'Pago tarjeta' });
  assert.equal(d.ok, true, d.error);
  assert.equal(tabla(e, 'Reglas').filter(r => r.Palabra_Clave === 'pago de tarjeta').length, 1);
  assert.equal(mov(e, 'mv_20').Categoria, 'Pago tarjeta');
  assert.equal(mov(e, 'mv_20').Origen, 'Auto');
  assert.equal(post(e, { accion: 'regla', token, palabra: 'pago de tarjeta', categoria: 'Pago tarjeta' }).ok, true, 'repetirla no duplica');
  assert.equal(tabla(e, 'Reglas').filter(r => r.Palabra_Clave === 'pago de tarjeta').length, 1);
  assert.match(post(e, { accion: 'regla', token, palabra: 'pago de tarjeta', categoria: 'Otros' }).error, /Ya existe/);
  const ed = conSesion('dos@example.com');
  assert.match(post(ed, { accion: 'regla', token: sesion(ed), palabra: 'algo', categoria: 'Otros' }).error, /Solo el administrador/);
});

test('la confianza se escribe como porcentaje y no se reescribe en cada pasada', () => {
  const e = conSesion();
  const token = sesion(e);
  post(e, { accion: 'clasificar', token, ids: ['mv_1'], categoria: 'Comida' });
  const conf = mov(e, 'mv_2').Confianza;
  assert.match(String(conf), /^\d+%$/);
  const antes = JSON.stringify(e.hojas.Movimientos.datos);
  post(e, { accion: 'datos', token });
  assert.equal(JSON.stringify(e.hojas.Movimientos.datos), antes, 'una segunda pasada no cambia nada');
});

test('datos trae el presupuesto (Default y por mes) y los pendientes', () => {
  const base = planillaBase();
  base.Presupuesto_Mensual = [['Categoria', 'Mes', 'Monto_Presupuestado'], ['Comida', 'Default', 400000], ['Comida', '2026-12-01', 500000], ['Bencina', 'Default', 120000]];
  base.Pendientes = [['Descripcion', 'Categoria', 'Monto_Estimado', 'Fecha_Estimada', 'Estado', 'Notas'], ['Seguro auto', 'Seguro', 30000, '2026-11-15', 'Pendiente', ''], ['Ya pagado', 'Seguro', 999, '2026-11-15', 'Concretado', '']];
  const e = crearEntorno(base, { token: { aud: 'cliente-1', email: 'dueno@example.com', email_verified: 'true' } });
  e.ctx.prepararPlanilla();
  e.hojas.App_Ajustes.datos.find(f => f[0] === 'googleClientId')[1] = 'cliente-1';
  const d = post(e, { accion: 'datos', token: sesion(e) });
  assert.deepEqual(JSON.parse(JSON.stringify(d.presupuesto)), { porDefecto: { Comida: 400000, Bencina: 120000 }, meses: { '2026-12': { Comida: 500000 } } });
  assert.deepEqual(JSON.parse(JSON.stringify(d.pendientes)), { '2026-11': { Seguro: 30000 } });
  assert.equal(d.tipoCambio, 0);
});

test('sin pestañas de presupuesto la app funciona igual', () => {
  const e = conSesion();
  const d = post(e, { accion: 'datos', token: sesion(e) });
  assert.equal(d.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(d.presupuesto)), { porDefecto: {}, meses: {} });
});

test('datos trae el último saldo de cada concepto', () => {
  const base = planillaBase();
  base.Saldos = [['Fecha', 'Cuenta', 'Concepto', 'Monto'],
    ['2026-10-31 11:55', 'Cuenta Corriente', 'Saldo en cuenta', 900000],
    ['2026-11-02 11:50', 'Cuenta Corriente', 'Saldo en cuenta', 850000],
    ['2026-11-02 11:50', 'Cuenta Corriente', 'Total disponible', 850000]];
  const e = crearEntorno(base, { token: { aud: 'cliente-1', email: 'dueno@example.com', email_verified: 'true' } });
  e.ctx.prepararPlanilla();
  e.hojas.App_Ajustes.datos.find(f => f[0] === 'googleClientId')[1] = 'cliente-1';
  const d = post(e, { accion: 'datos', token: sesion(e) });
  const s = JSON.parse(JSON.stringify(d.saldos)).sort((a, b) => a.concepto.localeCompare(b.concepto));
  assert.equal(s.length, 2);
  assert.equal(s[0].concepto, 'Saldo en cuenta');
  assert.equal(s[0].monto, 850000);
  assert.match(s[0].leidoEn, /^2026-11-02T/);
});
