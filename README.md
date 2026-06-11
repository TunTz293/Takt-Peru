# J.A.R.V.I.S. — Asistente Personal

Un asistente de voz estilo Iron Man, en español, hecho con HTML, CSS y JavaScript puro. No necesita instalación ni servidor: funciona directamente en el navegador.

## Cómo usarlo

1. Descarga o clona este repositorio.
2. Abre `index.html` en **Chrome** o **Edge** (necesarios para el reconocimiento de voz).
3. La primera vez, Jarvis te preguntará tu nombre para dirigirse a ti.
4. Habla con el botón del micrófono 🎤 o escribe en el cuadro de texto.

> Consejo: para que el micrófono funcione sin problemas, sírvelo en local con
> `python3 -m http.server` y abre `http://localhost:8000`, o publícalo en GitHub Pages.

## Comandos integrados

| Dices… | Jarvis… |
|---|---|
| «¿Qué hora es?» / «¿Qué día es hoy?» | Te da la hora o la fecha |
| «Busca [algo]» | Abre la búsqueda en Google |
| «Pon [canción]» / «Abre YouTube» | Busca o abre YouTube |
| «Wikipedia sobre [tema]» | Consulta Wikipedia en español |
| «Recuérdame [algo]» | Guarda un recordatorio |
| «Mis recordatorios» | Lee tus recordatorios guardados |
| «Cuéntame un chiste» | Humor de circuitos |
| «Llámame [nombre]» | Cambia cómo se dirige a ti |
| «Limpia el chat» | Despeja la pantalla |
| «Ayuda» | Muestra todos los comandos |

## Modo IA (opcional)

Si configuras una clave API de Claude (botón ⚙ → «Clave API de Claude»), Jarvis responderá **cualquier pregunta** con inteligencia artificial, manteniendo su personalidad y dirigiéndose a ti por tu nombre.

- Consigue una clave en [platform.claude.com](https://platform.claude.com).
- La clave se guarda **solo en tu navegador** (localStorage); nunca se sube a ningún lado.
- Sin clave, Jarvis funciona igual con todos los comandos integrados.

## Personalización

En el panel de configuración (⚙) puedes cambiar:

- **Tu nombre** y el **tratamiento** (señor, señora, jefe…).
- **La voz** de Jarvis (entre las voces en español de tu sistema).
- **La clave API** del modo IA.

Todo se guarda localmente en tu navegador.
