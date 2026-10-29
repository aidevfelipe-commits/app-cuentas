// Configuración pública de la app (nada de esto es secreto). Se usa también en el service worker.
self.APP_CONFIG = {
  // ID de cliente de Google (termina en .apps.googleusercontent.com). Igual al de App_Ajustes ▸ googleClientId.
  googleClientId: '357685647354-r3s6sh86lsabgrllp9tkru8pqgaomhrr.apps.googleusercontent.com',
  // Dirección de la API (implementación web de Apps Script, termina en /exec). Vacía = modo demo con dev-data.json.
  apiUrl: 'https://script.google.com/macros/s/AKfycbzJ9mnHaK8l6O8UGgFT048_yh08u3rorbbun9xl7e-KGEHt58yAc9siJxpC7fLUMbkJNQ/exec'
};
