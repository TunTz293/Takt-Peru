/* ============================================================
   Skills de JARVIS
   Cada skill se expone de dos formas:
   1. Como herramienta (tool) para Claude — name/description/input_schema/run
   2. Como comando de voz local (regex) — funciona sin clave API
   Para añadir una skill nueva, agrega un objeto a SKILLS.
   ============================================================ */

const CODIGOS_CLIMA = {
  0: "cielo despejado", 1: "mayormente despejado", 2: "parcialmente nublado",
  3: "nublado", 45: "niebla", 48: "niebla con escarcha",
  51: "llovizna ligera", 53: "llovizna", 55: "llovizna intensa",
  61: "lluvia ligera", 63: "lluvia", 65: "lluvia intensa",
  71: "nevada ligera", 73: "nevada", 75: "nevada intensa",
  80: "chubascos ligeros", 81: "chubascos", 82: "chubascos fuertes",
  95: "tormenta eléctrica", 96: "tormenta con granizo", 99: "tormenta fuerte con granizo",
};

const MONEDAS = {
  "soles": "PEN", "sol": "PEN", "dólares": "USD", "dolares": "USD", "dólar": "USD", "dolar": "USD",
  "euros": "EUR", "euro": "EUR", "libras": "GBP", "yenes": "JPY", "reales": "BRL",
  "pesos mexicanos": "MXN", "pesos chilenos": "CLP", "pesos colombianos": "COP", "pesos argentinos": "ARS",
};

function calcularSeguro(expresion) {
  const limpia = expresion.replace(/,/g, ".").replace(/\^/g, "**").replace(/[×x]/gi, "*").replace(/÷/g, "/");
  if (!/^[\d\s+\-*/().%e]+$/.test(limpia)) throw new Error("Expresión no válida: solo acepto números y operadores aritméticos");
  const resultado = Function(`"use strict"; return (${limpia})`)();
  if (typeof resultado !== "number" || !isFinite(resultado)) throw new Error("El cálculo no produjo un número válido");
  return resultado;
}

// ---------- Autenticación con Google (Tasks + Calendar) ----------
// Usa Google Identity Services: el usuario configura su ID de cliente OAuth
// en ⚙ y pulsa «Conectar Google». El token vive solo en memoria/sesión.
const googleAuth = {
  get clientId() { return localStorage.getItem("jarvis_google_client_id") || ""; },

  get token() {
    const t = JSON.parse(sessionStorage.getItem("jarvis_google_token") || "null");
    return t && Date.now() < t.expira ? t.valor : null;
  },

  guardarToken(valor, expiraEnSeg) {
    sessionStorage.setItem("jarvis_google_token", JSON.stringify({ valor, expira: Date.now() + (expiraEnSeg - 60) * 1000 }));
  },

  conectar() {
    return new Promise((resolve, reject) => {
      if (this.token) return resolve(this.token);
      if (!this.clientId) return reject(new Error("Configura tu ID de cliente de Google en ⚙ y pulsa «Conectar Google»"));
      if (!window.google?.accounts?.oauth2) return reject(new Error("La librería de Google no cargó; revisa tu conexión a internet"));
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: "https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events",
        callback: (resp) => {
          if (resp.error) return reject(new Error(`Google rechazó la conexión: ${resp.error}`));
          this.guardarToken(resp.access_token, resp.expires_in);
          resolve(resp.access_token);
        },
        error_callback: (e) => reject(new Error(`No se pudo conectar con Google: ${e.type || "ventana bloqueada o cerrada"}`)),
      });
      tc.requestAccessToken({ prompt: "" });
    });
  },

  async fetch(url, opciones = {}) {
    const token = await this.conectar();
    const res = await fetch(url, {
      ...opciones,
      headers: { ...(opciones.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      if (res.status === 401) sessionStorage.removeItem("jarvis_google_token");
      const e = await res.json().catch(() => ({}));
      throw new Error(e?.error?.message || `Error ${res.status} de Google`);
    }
    return res.status === 204 ? {} : res.json();
  },
};

// Hora local en formato ISO sin zona (para la API de Calendar con timeZone)
function isoLocal(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

const ZONA_HORARIA = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima";

const SKILLS = [
  // ---------------- Hora y fecha ----------------
  {
    name: "hora_fecha",
    etiqueta: "Hora y fecha",
    description: "Obtiene la fecha y hora actuales del usuario (zona horaria local). Úsala siempre que el usuario pregunte la hora, el día o la fecha.",
    input_schema: { type: "object", properties: {}, required: [] },
    async run() {
      const ahora = new Date();
      return `Fecha: ${ahora.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}. Hora: ${ahora.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}.`;
    },
  },

  // ---------------- Clima ----------------
  {
    name: "obtener_clima",
    etiqueta: "Clima",
    description: "Consulta el clima actual de cualquier ciudad del mundo (datos reales de Open-Meteo). Llámala cuando el usuario pregunte por el clima, la temperatura o si va a llover.",
    input_schema: {
      type: "object",
      properties: {
        ciudad: { type: "string", description: "Nombre de la ciudad, p. ej. 'Lima' o 'Arequipa'" },
      },
      required: ["ciudad"],
    },
    async run({ ciudad }) {
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(ciudad)}&count=1&language=es`).then((r) => r.json());
      const lugar = geo.results?.[0];
      if (!lugar) throw new Error(`No encontré la ciudad «${ciudad}»`);
      const clima = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lugar.latitude}&longitude=${lugar.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`).then((r) => r.json());
      const c = clima.current;
      const desc = CODIGOS_CLIMA[c.weather_code] || "condición desconocida";
      return `Clima en ${lugar.name}, ${lugar.country}: ${desc}, ${Math.round(c.temperature_2m)}°C (sensación de ${Math.round(c.apparent_temperature)}°C), humedad ${c.relative_humidity_2m}%, viento ${Math.round(c.wind_speed_10m)} km/h.`;
    },
    local: [
      {
        patron: /(?:clima|tiempo|temperatura)(?:\s+(?:en|de|para))?\s+([a-záéíóúñü\s]+)/i,
        args: (m) => ({ ciudad: m[1].trim() }),
      },
    ],
  },

  // ---------------- Calculadora ----------------
  {
    name: "calculadora",
    etiqueta: "Calculadora",
    description: "Evalúa expresiones aritméticas con precisión (suma, resta, multiplicación, división, potencias con ^, paréntesis). Úsala para cualquier cálculo numérico.",
    input_schema: {
      type: "object",
      properties: {
        expresion: { type: "string", description: "Expresión aritmética, p. ej. '(150*1.18)/3'" },
      },
      required: ["expresion"],
    },
    async run({ expresion }) {
      const r = calcularSeguro(expresion);
      return `${expresion} = ${Number(r.toFixed(8))}`;
    },
    local: [
      {
        patron: /(?:cuánto es|cuanto es|calcula|calcúlame|calculame)\s+([\d\s+\-*/().,%^×x÷]+)/i,
        args: (m) => ({ expresion: m[1].trim() }),
      },
    ],
  },

  // ---------------- Conversor de monedas ----------------
  {
    name: "conversor_moneda",
    etiqueta: "Monedas",
    description: "Convierte montos entre monedas con tipos de cambio reales del día (códigos ISO: PEN, USD, EUR, GBP, JPY, BRL, MXN, CLP, COP, ARS, etc.).",
    input_schema: {
      type: "object",
      properties: {
        monto: { type: "number", description: "Cantidad a convertir" },
        de: { type: "string", description: "Moneda de origen en código ISO, p. ej. 'USD'" },
        a: { type: "string", description: "Moneda de destino en código ISO, p. ej. 'PEN'" },
      },
      required: ["monto", "de", "a"],
    },
    async run({ monto, de, a }) {
      de = de.toUpperCase(); a = a.toUpperCase();
      const data = await fetch(`https://open.er-api.com/v6/latest/${de}`).then((r) => r.json());
      if (data.result !== "success") throw new Error(`No reconozco la moneda «${de}»`);
      const tasa = data.rates[a];
      if (!tasa) throw new Error(`No reconozco la moneda «${a}»`);
      return `${monto} ${de} = ${(monto * tasa).toFixed(2)} ${a} (tipo de cambio: 1 ${de} = ${tasa.toFixed(4)} ${a}).`;
    },
    local: [
      {
        patron: /(?:convierte|cuánto son|cuanto son|cambia)\s+([\d.,]+)\s+([a-záéíóúñ\s]+?)\s+(?:a|en)\s+([a-záéíóúñ\s]+)/i,
        args: (m) => {
          const cod = (s) => MONEDAS[s.trim().toLowerCase()] || s.trim().toUpperCase();
          return { monto: parseFloat(m[1].replace(",", ".")), de: cod(m[2]), a: cod(m[3]) };
        },
      },
    ],
  },

  // ---------------- Temporizador ----------------
  {
    name: "temporizador",
    etiqueta: "Temporizador",
    description: "Inicia un temporizador (cuenta regresiva). Al terminar, JARVIS avisa al usuario en voz alta. Convierte lo que pida el usuario a segundos.",
    input_schema: {
      type: "object",
      properties: {
        segundos: { type: "integer", description: "Duración total en segundos" },
        motivo: { type: "string", description: "Para qué es el temporizador (opcional)" },
      },
      required: ["segundos"],
    },
    async run({ segundos, motivo }) {
      if (segundos <= 0 || segundos > 86400) throw new Error("La duración debe ser entre 1 segundo y 24 horas");
      const fin = motivo ? ` para ${motivo}` : "";
      setTimeout(() => {
        window.jarvisResponder?.(`⏰ ¡Tiempo cumplido${fin}!`);
      }, segundos * 1000);
      const min = Math.floor(segundos / 60), seg = segundos % 60;
      const dur = min ? `${min} minuto(s)${seg ? ` y ${seg} segundo(s)` : ""}` : `${seg} segundo(s)`;
      return `Temporizador de ${dur}${fin} iniciado. Avisaré cuando termine.`;
    },
    local: [
      {
        patron: /temporizador(?:\s+de)?\s+(\d+)\s*(segundos?|minutos?|horas?)/i,
        args: (m) => {
          const n = parseInt(m[1], 10);
          const factor = m[2].startsWith("hora") ? 3600 : m[2].startsWith("min") ? 60 : 1;
          return { segundos: n * factor };
        },
      },
    ],
  },

  // ---------------- Recordatorios ----------------
  {
    name: "recordatorios",
    etiqueta: "Recordatorios",
    description:
      "Notas y recordatorios rápidos SIN fecha/hora, guardados localmente en el navegador. " +
      "Acciones: 'guardar' (requiere texto), 'listar', 'borrar_todos'. " +
      "Para recordatorios con fecha u hora concreta usa google_calendar con aviso_minutos en su lugar.",
    input_schema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["guardar", "listar", "borrar_todos"], description: "Qué hacer con los recordatorios" },
        texto: { type: "string", description: "Contenido del recordatorio (solo para 'guardar')" },
      },
      required: ["accion"],
    },
    async run({ accion, texto }) {
      const leer = () => JSON.parse(localStorage.getItem("jarvis_recordatorios") || "[]");
      const escribir = (l) => localStorage.setItem("jarvis_recordatorios", JSON.stringify(l));
      if (accion === "guardar") {
        if (!texto) throw new Error("Falta el texto del recordatorio");
        const lista = leer();
        lista.push({ texto, fecha: new Date().toLocaleString("es-PE") });
        escribir(lista);
        return `Recordatorio guardado: «${texto}».`;
      }
      if (accion === "listar") {
        const lista = leer();
        if (!lista.length) return "No hay recordatorios guardados.";
        return `Recordatorios (${lista.length}):\n` + lista.map((r, i) => `${i + 1}. ${r.texto} (${r.fecha})`).join("\n");
      }
      if (accion === "borrar_todos") {
        escribir([]);
        return "Todos los recordatorios fueron eliminados.";
      }
      throw new Error(`Acción desconocida: ${accion}`);
    },
    local: [
      { patron: /(?:recuérdame|recuerdame|anota|apunta)\s+(?:que\s+)?(.+)/i, args: (m) => ({ accion: "guardar", texto: m[1] }) },
      { patron: /(?:mis recordatorios|mis notas|qué anotaste|que anotaste)/i, args: () => ({ accion: "listar" }) },
      { patron: /(?:borra|elimina|limpia).*(?:recordatorios|notas)/i, args: () => ({ accion: "borrar_todos" }) },
    ],
  },

  // ---------------- Google Tasks ----------------
  {
    name: "google_tasks",
    etiqueta: "Google Tasks",
    description:
      "Gestiona las tareas del usuario en Google Tasks (su lista real, sincronizada con su cuenta). " +
      "Acciones: 'crear' (requiere titulo; opcional notas y fecha_limite), 'listar' (tareas pendientes), " +
      "'completar' (marca como hecha la tarea cuyo título coincida con titulo). " +
      "Úsala siempre que el usuario hable de tareas, pendientes o cosas por hacer.",
    input_schema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["crear", "listar", "completar"], description: "Operación a realizar" },
        titulo: { type: "string", description: "Título de la tarea (para crear o completar)" },
        notas: { type: "string", description: "Detalles adicionales de la tarea (opcional)" },
        fecha_limite: { type: "string", description: "Fecha límite en formato YYYY-MM-DD (opcional)" },
      },
      required: ["accion"],
    },
    async run({ accion, titulo, notas, fecha_limite }) {
      const BASE = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks";
      if (accion === "crear") {
        if (!titulo) throw new Error("Falta el título de la tarea");
        const cuerpo = { title: titulo };
        if (notas) cuerpo.notes = notas;
        if (fecha_limite) cuerpo.due = `${fecha_limite}T00:00:00.000Z`;
        const t = await googleAuth.fetch(BASE, { method: "POST", body: JSON.stringify(cuerpo) });
        return `Tarea creada en Google Tasks: «${t.title}»${fecha_limite ? ` con fecha límite ${fecha_limite}` : ""}.`;
      }
      if (accion === "listar") {
        const data = await googleAuth.fetch(`${BASE}?showCompleted=false&maxResults=20`);
        const items = data.items || [];
        if (!items.length) return "No hay tareas pendientes en Google Tasks.";
        return `Tareas pendientes (${items.length}):\n` + items.map((t, i) =>
          `${i + 1}. ${t.title}${t.due ? ` (vence ${t.due.slice(0, 10)})` : ""}${t.notes ? ` — ${t.notes}` : ""}`
        ).join("\n");
      }
      if (accion === "completar") {
        if (!titulo) throw new Error("Indica el título de la tarea a completar");
        const data = await googleAuth.fetch(`${BASE}?showCompleted=false&maxResults=50`);
        const t = (data.items || []).find((x) => x.title.toLowerCase().includes(titulo.toLowerCase()));
        if (!t) throw new Error(`No encontré una tarea pendiente que contenga «${titulo}»`);
        await googleAuth.fetch(`${BASE}/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
        return `Tarea completada: «${t.title}». Bien hecho.`;
      }
      throw new Error(`Acción desconocida: ${accion}`);
    },
    local: [
      { patron: /(?:agrega|añade|anade|crea)(?:r)?\s+(?:una\s+)?tarea\s+(?:de\s+|para\s+)?(.+)/i, args: (m) => ({ accion: "crear", titulo: m[1].trim() }) },
      { patron: /(?:mis tareas|tareas pendientes|qué tengo que hacer|que tengo que hacer)/i, args: () => ({ accion: "listar" }) },
      { patron: /(?:completa|marca|termina)(?:r)?\s+(?:la\s+)?tarea\s+(?:de\s+)?(.+)/i, args: (m) => ({ accion: "completar", titulo: m[1].trim() }) },
    ],
  },

  // ---------------- Google Calendar ----------------
  {
    name: "google_calendar",
    etiqueta: "Google Calendar",
    description:
      "Gestiona el calendario de Google del usuario (calendario principal, sincronizado con su cuenta). " +
      "Acciones: 'crear_evento' (requiere titulo e inicio; opcional duracion_minutos, descripcion, aviso_minutos) " +
      "y 'listar' (próximos eventos). Úsala para citas, reuniones, eventos y RECORDATORIOS CON FECHA/HORA " +
      "(crea un evento con aviso_minutos para que el teléfono notifique al usuario). " +
      "Si el evento nace de una tarea de google_tasks, menciona la tarea en la descripcion para asociarlos.",
    input_schema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["crear_evento", "listar"], description: "Operación a realizar" },
        titulo: { type: "string", description: "Título del evento" },
        inicio: { type: "string", description: "Fecha y hora de inicio en hora local, formato YYYY-MM-DDTHH:MM:SS (calcula la fecha exacta a partir de la fecha actual que conoces)" },
        duracion_minutos: { type: "integer", description: "Duración en minutos (por defecto 60)" },
        descripcion: { type: "string", description: "Detalles del evento; si está asociado a una tarea de Tasks, indícalo aquí (opcional)" },
        aviso_minutos: { type: "integer", description: "Minutos antes del evento para enviar una notificación (úsalo para recordatorios)" },
      },
      required: ["accion"],
    },
    async run({ accion, titulo, inicio, duracion_minutos = 60, descripcion, aviso_minutos }) {
      const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
      if (accion === "crear_evento") {
        if (!titulo || !inicio) throw new Error("Faltan el título o la fecha/hora de inicio");
        const ini = new Date(inicio);
        if (isNaN(ini)) throw new Error(`No entiendo la fecha «${inicio}»`);
        const fin = new Date(ini.getTime() + duracion_minutos * 60000);
        const cuerpo = {
          summary: titulo,
          description: descripcion || "",
          start: { dateTime: isoLocal(ini), timeZone: ZONA_HORARIA },
          end: { dateTime: isoLocal(fin), timeZone: ZONA_HORARIA },
        };
        if (aviso_minutos != null) {
          cuerpo.reminders = { useDefault: false, overrides: [{ method: "popup", minutes: aviso_minutos }] };
        }
        const ev = await googleAuth.fetch(BASE, { method: "POST", body: JSON.stringify(cuerpo) });
        const cuando = ini.toLocaleString("es-PE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
        return `Evento creado en Google Calendar: «${ev.summary}» el ${cuando}` +
          (aviso_minutos != null ? `, con aviso ${aviso_minutos} minutos antes` : "") +
          `. Enlace: ${ev.htmlLink}`;
      }
      if (accion === "listar") {
        const params = new URLSearchParams({
          timeMin: new Date().toISOString(),
          maxResults: "10",
          singleEvents: "true",
          orderBy: "startTime",
        });
        const data = await googleAuth.fetch(`${BASE}?${params}`);
        const items = data.items || [];
        if (!items.length) return "No hay eventos próximos en el calendario.";
        return `Próximos eventos (${items.length}):\n` + items.map((e) => {
          const f = e.start.dateTime
            ? new Date(e.start.dateTime).toLocaleString("es-PE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            : e.start.date;
          return `• ${f} — ${e.summary}`;
        }).join("\n");
      }
      throw new Error(`Acción desconocida: ${accion}`);
    },
    local: [
      { patron: /(?:mis eventos|mi agenda|qué tengo en (?:el|la) (?:calendario|agenda)|que tengo en (?:el|la) (?:calendario|agenda)|próximos eventos|proximos eventos)/i, args: () => ({ accion: "listar" }) },
    ],
  },

  // ---------------- Web ----------------
  {
    name: "abrir_web",
    etiqueta: "Búsqueda web",
    description: "Abre una pestaña del navegador: búsqueda en Google, videos en YouTube, artículos de Wikipedia en español, o una URL directa. Úsala cuando el usuario pida buscar, reproducir o abrir algo en la web.",
    input_schema: {
      type: "object",
      properties: {
        destino: { type: "string", enum: ["google", "youtube", "wikipedia", "url"], description: "Dónde abrir" },
        consulta: { type: "string", description: "Términos de búsqueda, o la URL completa si destino es 'url'" },
      },
      required: ["destino", "consulta"],
    },
    async run({ destino, consulta }) {
      const urls = {
        google: "https://www.google.com/search?q=" + encodeURIComponent(consulta),
        youtube: "https://www.youtube.com/results?search_query=" + encodeURIComponent(consulta),
        wikipedia: "https://es.wikipedia.org/wiki/Special:Search?search=" + encodeURIComponent(consulta),
        url: consulta.startsWith("http") ? consulta : "https://" + consulta,
      };
      window.open(urls[destino], "_blank");
      return destino === "url" ? `Abriendo ${consulta}.` : `Abriendo ${destino} con «${consulta}».`;
    },
    local: [
      { patron: /busca(?:r)?(?: en google)?\s+(.+)/i, args: (m) => ({ destino: "google", consulta: m[1] }) },
      { patron: /(?:pon|reproduce|busca en youtube)\s+(.+)/i, args: (m) => ({ destino: "youtube", consulta: m[1] }) },
      { patron: /wikipedia\s+(?:de\s+|sobre\s+)?(.+)/i, args: (m) => ({ destino: "wikipedia", consulta: m[1] }) },
    ],
  },
];

// Herramientas en el formato que espera la API de Claude
const HERRAMIENTAS_CLAUDE = SKILLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

async function ejecutarSkill(nombre, input) {
  const skill = SKILLS.find((s) => s.name === nombre);
  if (!skill) throw new Error(`Skill desconocida: ${nombre}`);
  return skill.run(input);
}

// Intenta resolver el texto con los patrones locales de las skills (sin IA)
function skillLocal(texto) {
  for (const skill of SKILLS) {
    for (const { patron, args } of skill.local || []) {
      const m = texto.match(patron);
      if (m) return { skill, input: args(m) };
    }
  }
  return null;
}
