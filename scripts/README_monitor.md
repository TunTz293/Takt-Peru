# Monitor Prestamype — Configuración

## Qué hace
Cada hora (lunes a viernes, 8am–8pm hora Perú) revisa las oportunidades de inversión
en Prestamype y te envía un email a `warcaya.armar@gmail.com` si hay oportunidades
con retorno anualizado **mayor al 18%** que no hayas visto antes.

## Configurar los Secrets en GitHub

Ve a tu repositorio en GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Cómo obtenerlo |
|--------|---------------|
| `PRESTAMYPE_TOKEN` | Ver instrucciones abajo |
| `GMAIL_USER` | Tu dirección Gmail (ej: `warcaya.armar@gmail.com`) |
| `GMAIL_APP_PASSWORD` | Ver instrucciones abajo |

### Obtener PRESTAMYPE_TOKEN

1. Abre Chrome/Firefox y entra a [prestamype.com](https://www.prestamype.com)
2. Inicia sesión con tu cuenta de inversionista
3. Abre DevTools (F12) → pestaña **Network**
4. Recarga la página de oportunidades
5. Haz clic en cualquier request a `prestamype.com/api/...`
6. En **Request Headers** busca: `Authorization: Bearer <TOKEN>`
7. Copia ese token y guárdalo como secret `PRESTAMYPE_TOKEN`

> ⚠️ El token puede expirar. Si el script falla con error 401, repite este proceso.

### Obtener Gmail App Password

1. Ve a [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Selecciona "Correo" y "Otro dispositivo"
3. Copia la contraseña de 16 caracteres generada
4. Guárdala como secret `GMAIL_APP_PASSWORD`

> Requiere tener activada la verificación en 2 pasos en tu cuenta Google.

## Ejecución manual

En GitHub → tu repositorio → **Actions → Monitor Prestamype Oportunidades → Run workflow**
