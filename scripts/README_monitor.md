# Monitor Prestamype — Configuración

## Qué hace
Cada hora (lunes a viernes, 8am–8pm hora Perú) abre un navegador automatizado,
inicia sesión en Prestamype con tus credenciales y te envía un email a
`warcaya.armar@gmail.com` si hay oportunidades con retorno anualizado **> 18%**.

## Secrets necesarios en GitHub

Ve a tu repositorio → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor |
|--------|-------|
| `PRESTAMYPE_EMAIL` | Tu email de Prestamype |
| `PRESTAMYPE_PASSWORD` | Tu contraseña de Prestamype |
| `GMAIL_USER` | `warcaya.armar@gmail.com` |
| `GMAIL_APP_PASSWORD` | Contraseña de app Gmail (ver abajo) |

### Obtener Gmail App Password

1. Ve a [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Selecciona "Correo" → "Otro dispositivo" → ponle nombre "Prestamype Monitor"
3. Copia la contraseña de 16 caracteres
4. Guárdala como `GMAIL_APP_PASSWORD`

> Requiere verificación en 2 pasos activada en tu cuenta Google.

## Ejecución manual

GitHub → tu repositorio → **Actions → Monitor Prestamype Oportunidades → Run workflow**
