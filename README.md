# J.A.R.V.I.S. — Asistente Personal conectado a Claude

Un asistente de voz estilo Iron Man, en español, hecho con HTML, CSS y JavaScript puro. No necesita instalación ni servidor: funciona directamente en el navegador, **conectado a Claude** y con un sistema de **skills** que la IA puede usar por sí misma.

## Cómo usarlo

1. Descarga o clona este repositorio.
2. Abre `index.html` en **Chrome** o **Edge** (necesarios para el reconocimiento de voz).
3. La primera vez, Jarvis te preguntará tu nombre para dirigirse a ti.
4. Habla con el botón del micrófono 🎤 o escribe en el cuadro de texto.

> Consejo: para que el micrófono funcione sin problemas, sírvelo en local con
> `python3 -m http.server` y abre `http://localhost:8000`, o publícalo en GitHub Pages.

## Conexión a Claude

Pulsa ⚙ y pega tu clave API de Claude (consíguela en [platform.claude.com](https://platform.claude.com)). Con la conexión activa:

- Jarvis le pasa tu pregunta a **Claude (claude-opus-4-8)** con su personalidad y tu nombre.
- Claude **decide solo qué skills usar** (tool use): puede consultar el clima real, calcular, convertir monedas, poner temporizadores, guardar recordatorios o abrir webs, y combinar varias skills en una misma petición ("¿cuánto son 50 dólares en soles y qué clima hace en Cusco?").
- La clave se guarda **solo en tu navegador** (localStorage); nunca se sube a ningún lado.

Sin clave, Jarvis sigue funcionando: cada skill tiene comandos de voz directos.

## Skills disponibles

| Skill | Qué hace | Comando directo (sin IA) |
|---|---|---|
| 🕐 Hora y fecha | Fecha y hora locales | «¿qué hora es?» |
| 🌤 Clima | Clima real de cualquier ciudad (Open-Meteo) | «clima en Lima» |
| 🧮 Calculadora | Aritmética precisa | «cuánto es 150 * 1.18» |
| 💱 Monedas | Tipos de cambio reales del día | «convierte 100 dólares a soles» |
| ⏱ Temporizador | Cuenta regresiva con aviso por voz | «temporizador de 5 minutos» |
| 📝 Recordatorios | Guardar, listar y borrar notas | «recuérdame…» / «mis recordatorios» |
| 🌐 Web | Google, YouTube, Wikipedia, URLs | «busca…», «pon [canción]» |

Además: chistes, «llámame [nombre]», «limpia el chat», «ayuda».

### Añadir una skill nueva

Las skills viven en `skills.js`. Cada una es un objeto con:

```js
{
  name: "mi_skill",            // nombre para Claude (sin espacios ni tildes)
  etiqueta: "Mi skill",        // nombre visible en la interfaz
  description: "…",            // cuándo y cómo debe usarla Claude
  input_schema: { … },         // parámetros en JSON Schema
  async run(input) { … },      // la implementación; devuelve un string
  local: [                     // (opcional) comandos de voz sin IA
    { patron: /regex/i, args: (m) => ({ … }) },
  ],
}
```

Agrégala al array `SKILLS` y queda disponible automáticamente para Claude y en la barra de skills.

## Personalización

En el panel ⚙ puedes cambiar tu nombre, el tratamiento (señor, señora, jefe…), la voz de Jarvis y la clave API. Todo se guarda localmente en tu navegador.
