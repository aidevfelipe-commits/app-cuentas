# Cuentas

Control de gastos compartido: revisar y clasificar los movimientos del banco desde el teléfono.

La página vive en GitHub Pages (`web/`), los datos en la planilla privada "Control de Gastos" (Google
Sheets) y el servidor es un Google Apps Script (`apps-script/`) ligado a esa planilla. Los movimientos
los sube un proceso local del dueño. Este repositorio es público y **solo tiene código**: ningún dato real.

- Probar sin servidor: `cd web && python3 -m http.server 8766` y abrir `http://localhost:8766/?demo` (datos inventados).
- Pruebas: `node --test tests/*.test.js` (clasificador y servidor contra una planilla simulada).
- Configuración inicial: [docs/CONFIGURACION.md](docs/CONFIGURACION.md). Uso y ajustes: [docs/MANUAL-ADMIN.md](docs/MANUAL-ADMIN.md).
