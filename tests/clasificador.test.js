// Pruebas del clasificador (datos inventados). Correr con: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../apps-script/Clasificador.js');

const CATS = ['Comida', 'Bencina', 'Otros', 'Aportes', 'Abono'];
let fila = 2;
function mov(glosa, categoria = c.SIN_CLASIFICAR, origen = c.SIN_CLASIFICAR, monto = -10000, cuenta = 'Tarjeta de Crédito') {
  return { fila: fila++, glosa, monto, cuenta, categoria, origen, sugerencia: '', confianza: '' };
}
function confirmado(glosa, categoria, monto, cuenta) {
  return mov(glosa, categoria, 'Manual', monto, cuenta);
}
function cambioDe(plan, m) {
  return plan.cambios.find(x => x.fila === m.fila);
}

test('la huella ignora números, tildes y símbolos', () => {
  assert.equal(c.huella('COMPRA 1234 PANADERÍA LA ESPIGA 24/10'), 'compra panaderia la espiga');
  assert.equal(c.huella('Compra panaderia La Espiga 3 de 6'), 'compra panaderia la espiga de');
  assert.equal(c.huella('12345 / 678'), '');
});

test('reglas: palabra completa, gana la más larga y el empate no decide', () => {
  const reglas = c.crearReglas([
    { Palabra_Clave: 'cafe', Categoria: 'Comida' },
    { Palabra_Clave: 'copec', Categoria: 'Bencina' },
    { Palabra_Clave: 'copec tienda', Categoria: 'Comida' },
    { Palabra_Clave: 'pase', Categoria: 'Otros' },
    { Palabra_Clave: 'ruta', Categoria: 'Bencina' }
  ]);
  assert.equal(c.aplicarReglas(reglas, 'CAFE CENTRAL'), reglas.find(r => r.palabra === 'cafe'));
  assert.equal(c.aplicarReglas(reglas, 'CAFETERIA NORTE'), null);
  assert.equal(c.aplicarReglas(reglas, 'COPEC TIENDA 22').categoria, 'Comida');
  assert.equal(c.aplicarReglas(reglas, 'COPEC 1234').categoria, 'Bencina');
  assert.equal(c.aplicarReglas(reglas, 'PASE RUTA'), null, 'mismo largo, distinta categoría');
});

test('regla Recordada calza por huella aunque cambien los números', () => {
  const reglas = c.crearReglas([{ Palabra_Clave: 'transferencia juan perez', Categoria: 'Aportes', Origen: 'Recordada' }]);
  assert.equal(c.aplicarReglas(reglas, 'Transferencia a 99887766 Juan Pérez').categoria, 'Aportes');
});

test('memoria: con una decisión sugiere, con dos iguales clasifica sola', () => {
  const uno = [confirmado('PANADERIA LA ESPIGA 01', 'Comida')];
  let plan = c.planificarClasificacion([...uno, mov('PANADERIA LA ESPIGA 77')], [], CATS);
  let r = Object.values(plan.resultados)[0];
  assert.equal(r.categoria, 'Comida');
  assert.equal(r.auto, false);

  const dos = [...uno, confirmado('PANADERIA LA ESPIGA 02', 'Comida')];
  const pendiente = mov('PANADERIA LA ESPIGA 99');
  plan = c.planificarClasificacion([...dos, pendiente], [], CATS);
  assert.deepEqual(cambioDe(plan, pendiente).campos.Categoria, 'Comida');
  assert.equal(cambioDe(plan, pendiente).campos.Origen, 'Auto');
});

test('memoria contradictoria solo sugiere la mayoría', () => {
  const movs = [
    confirmado('SUPER UNO', 'Comida'), confirmado('SUPER UNO', 'Comida'), confirmado('SUPER UNO', 'Otros')
  ];
  const p = mov('SUPER UNO');
  const plan = c.planificarClasificacion([...movs, p], [], CATS);
  const r = plan.resultados[p.fila];
  assert.equal(r.auto, false);
  assert.equal(r.categoria, 'Comida');
  assert.match(r.motivo, /2 de 3/);
});

test('la memoria del comercio gana a una regla genérica', () => {
  const reglas = [{ Palabra_Clave: 'copec', Categoria: 'Bencina' }];
  const movs = [confirmado('COPEC TIENDA PRONTO 1', 'Comida'), confirmado('COPEC TIENDA PRONTO 2', 'Comida')];
  const p = mov('COPEC TIENDA PRONTO 3');
  const plan = c.planificarClasificacion([...movs, p], reglas, CATS);
  assert.equal(cambioDe(plan, p).campos.Categoria, 'Comida');
});

test('las transferencias nunca se clasifican solas por memoria', () => {
  const movs = [
    confirmado('Transferencia a Maria Soto', 'Aportes', -50000, 'Cuenta Corriente'),
    confirmado('Transferencia a Maria Soto', 'Aportes', -50000, 'Cuenta Corriente')
  ];
  const p = mov('Transferencia a Maria Soto', c.SIN_CLASIFICAR, c.SIN_CLASIFICAR, -50000, 'Cuenta Corriente');
  const plan = c.planificarClasificacion([...movs, p], [], CATS);
  assert.equal(plan.resultados[p.fila].auto, false);
  assert.equal(plan.resultados[p.fila].categoria, 'Aportes');
  assert.equal(cambioDe(plan, p).campos.Sugerencia, 'Aportes');
});

test('lo clasificado a mano en la planilla queda Manual y lo Manual no se toca', () => {
  const planilla = mov('ALGO', 'Otros', c.SIN_CLASIFICAR);
  const manual = confirmado('OTRA COSA', 'Comida');
  const plan = c.planificarClasificacion([planilla, manual], [], CATS);
  assert.equal(cambioDe(plan, planilla).campos.Origen, 'Manual');
  assert.equal(cambioDe(plan, manual), undefined);
});

test('una categoría inválida no cuenta como confirmada', () => {
  const raro = mov('ALGO', 'Categoria vieja', c.SIN_CLASIFICAR);
  const plan = c.planificarClasificacion([raro], [], CATS);
  assert.equal(cambioDe(plan, raro), undefined);
});

test('Auto se corrige cuando aprende algo más seguro', () => {
  const auto = mov('PANADERIA LA ESPIGA 5', 'Otros', 'Auto');
  const movs = [confirmado('PANADERIA LA ESPIGA 1', 'Comida'), confirmado('PANADERIA LA ESPIGA 2', 'Comida')];
  const plan = c.planificarClasificacion([...movs, auto], [], CATS);
  assert.equal(cambioDe(plan, auto).campos.Categoria, 'Comida');
});

test('sin cambios no se reescribe la sugerencia', () => {
  const movs = [confirmado('PANADERIA LA ESPIGA 1', 'Comida')];
  const p = mov('PANADERIA LA ESPIGA 2');
  const primera = c.planificarClasificacion([...movs, p], [], CATS);
  const campos = cambioDe(primera, p).campos;
  p.sugerencia = campos.Sugerencia;
  p.confianza = campos.Confianza;
  assert.equal(cambioDe(c.planificarClasificacion([...movs, p], [], CATS), p), undefined);
});

// Datos con patrón claro: 3 rubros con palabras propias y montos distintos
function historia(n) {
  const rubros = [
    ['Comida', ['supermercado', 'panaderia', 'verduleria'], -25000],
    ['Bencina', ['servicentro', 'combustible', 'gasolinera'], -40000],
    ['Abono', ['remuneracion', 'deposito'], 900000]
  ];
  const out = [];
  for (let i = 0; i < n; i++) {
    const [cat, palabras, monto] = rubros[i % rubros.length];
    out.push(confirmado(`${palabras[i % palabras.length].toUpperCase()} ${['NORTE', 'SUR', 'CENTRO', 'ORIENTE'][i % 4]} ${i}`, cat, monto + i));
  }
  return out;
}

test('el modelo no clasifica solo hasta demostrar que acierta', () => {
  const pocos = historia(9);
  assert.equal(c.evaluarModelo(pocos, 0.95).confiable, false);
  const muchos = historia(60);
  const ev = c.evaluarModelo(muchos, 0.95);
  assert.equal(ev.confiable, true);
  assert.ok(ev.acierto > 0.9);
});

test('con un modelo confiable, un comercio nuevo de un rubro conocido se clasifica solo', () => {
  const p = mov('SUPERMERCADO PONIENTE 1', c.SIN_CLASIFICAR, c.SIN_CLASIFICAR, -24000);
  const plan = c.planificarClasificacion([...historia(60), p], [], CATS);
  const r = plan.resultados[p.fila];
  assert.equal(r.categoria, 'Comida');
  assert.equal(r.auto, true);
});

test('con un modelo nuevo solo sugiere', () => {
  const p = mov('SUPERMERCADO PONIENTE 1', c.SIN_CLASIFICAR, c.SIN_CLASIFICAR, -24000);
  const plan = c.planificarClasificacion([...historia(9), p], [], CATS);
  const r = plan.resultados[p.fila];
  assert.equal(r.categoria, 'Comida');
  assert.equal(r.auto, false);
});

test('sin pistas no sugiere nada', () => {
  const p = mov('XYZW QWERTY');
  const plan = c.planificarClasificacion([p], [], CATS);
  assert.equal(plan.resultados[p.fila], null);
});
