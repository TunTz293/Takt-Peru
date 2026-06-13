/* ============================================================
   J.A.R.V.I.S. — Asistente personal de voz en español
   Conectado a Claude (API de Anthropic) con skills (tool use).
   Las skills están definidas en skills.js y también funcionan
   sin clave API mediante comandos de voz directos.
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const chat = $("#chat");
const entrada = $("#entrada");
const btnEnviar = $("#btn-enviar");
const fallback = $("#fallback");
const reactor = $("#reactor");
const estado = $("#estado");
const dlgConfig = $("#config");

// ---------- Configuración persistente ----------
const cfg = {
  get nombre() { return localStorage.getItem("jarvis_nombre") || ""; },
  set nombre(v) { localStorage.setItem("jarvis_nombre", v); },
  get trato() { return localStorage.getItem("jarvis_trato") ?? "señor"; },
  set trato(v) { localStorage.setItem("jarvis_trato", v); },
  get apiKey() { return localStorage.getItem("jarvis_apikey") || ""; },
  set apiKey(v) { localStorage.setItem("jarvis_apikey", v); },
  get voz() { return localStorage.getItem("jarvis_voz") || ""; },
  set voz(v) { localStorage.setItem("jarvis_voz", v); },
  get googleClientId() { return localStorage.getItem("jarvis_google_client_id") || ""; },
  set googleClientId(v) { localStorage.setItem("jarvis_google_client_id", v); },
  get msClientId() { return localStorage.getItem("jarvis_ms_client_id") || ""; },
  set msClientId(v) { localStorage.setItem("jarvis_ms_client_id", v); },
};

// Forma de dirigirse al usuario: "señor Warcaya", "jefe", o solo el nombre
function tratamiento() {
  const partes = [cfg.trato, cfg.nombre].filter(Boolean);
  return partes.join(" ") || "señor";
}

// ---------- Interfaz ----------
function setEstado(modo, texto) {
  reactor.className = "reactor " + modo;
  estado.textContent = texto;
}

function agregarMensaje(texto, quien) {
  const div = document.createElement("div");
  div.className = "msg " + quien;
  div.textContent = texto;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// Lluvia digital estilo Matrix en el canvas de fondo
function iniciarLluvia() {
  const canvas = $("#rain");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const glifos = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789:.=*+JARVIS".split("");
  let cols, gotas, paso = 16;

  function dimensionar() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = Math.floor(canvas.width / paso);
    gotas = Array(cols).fill(0).map(() => Math.random() * -canvas.height);
  }
  dimensionar();
  window.addEventListener("resize", dimensionar);

  setInterval(() => {
    ctx.fillStyle = "rgba(0, 3, 0, 0.08)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = paso + "px monospace";
    for (let i = 0; i < cols; i++) {
      const g = glifos[Math.floor(Math.random() * glifos.length)];
      const x = i * paso, y = gotas[i] * paso;
      ctx.fillStyle = Math.random() > 0.96 ? "#d6ffe0" : "#00ff41";
      ctx.fillText(g, x, y);
      if (y > canvas.height && Math.random() > 0.975) gotas[i] = 0;
      gotas[i]++;
    }
  }, 60);
}

// ---------- Voz (síntesis) ----------
let voces = [];
function cargarVoces() {
  voces = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("es"));
  const sel = $("#cfg-voz");
  sel.innerHTML = "";
  for (const v of voces) {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    if (v.name === cfg.voz) opt.selected = true;
    sel.appendChild(opt);
  }
}
speechSynthesis.onvoiceschanged = cargarVoces;
cargarVoces();

function hablar(texto) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = "es-PE";
  const voz = voces.find((v) => v.name === cfg.voz) || voces[0];
  if (voz) u.voice = voz;
  u.rate = 1.02;
  u.pitch = 0.95;
  u.onstart = () => setEstado("speaking", "Hablando");
  u.onend = () => setEstado("idle", "En espera");
  speechSynthesis.speak(u);
}

function responder(texto) {
  agregarMensaje(texto, "jarvis");
  hablar(texto);
}
// Permite que las skills (p. ej. el temporizador) hablen por Jarvis
window.jarvisResponder = responder;

// ---------- Voz (reconocimiento) ----------
const Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (Reconocedor) {
  rec = new Reconocedor();
  rec.lang = "es-PE";
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => setEstado("listening", "Escuchando");
  rec.onend = () => {
    if (!reactor.classList.contains("thinking")) setEstado("idle", "En espera");
  };
  rec.onerror = (e) => {
    setEstado("idle", "En espera");
    if (e.error === "not-allowed") {
      agregarMensaje("Necesito permiso para usar el micrófono.", "jarvis");
    }
  };
  rec.onresult = (e) => {
    const texto = e.results[0][0].transcript.trim();
    procesarEntrada(texto);
  };
} else {
  // Sin reconocimiento de voz (p. ej. iPhone/Safari): mostrar entrada de texto
  fallback.hidden = false;
}

// El núcleo es el botón para hablar (voice-first). Si no hay voz, enfoca el texto.
reactor.addEventListener("click", () => {
  speechSynthesis.cancel();
  if (rec) {
    try { rec.start(); } catch { rec.stop(); }
  } else {
    fallback.hidden = false;
    entrada.focus();
  }
});

// ---------- Entrada por texto (respaldo) ----------
btnEnviar.addEventListener("click", enviarTexto);
entrada.addEventListener("keydown", (e) => { if (e.key === "Enter") enviarTexto(); });

function enviarTexto() {
  const texto = entrada.value.trim();
  if (!texto) return;
  entrada.value = "";
  procesarEntrada(texto);
}

// ---------- Onboarding: primera vez pide el nombre ----------
let esperandoNombre = !cfg.nombre;

function procesarEntrada(texto) {
  agregarMensaje(texto, "usuario");

  if (esperandoNombre) {
    const nombre = texto.replace(/^(me llamo|soy|mi nombre es)\s+/i, "").trim();
    cfg.nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);
    esperandoNombre = false;
    responder(`Un placer, ${tratamiento()}. Sistemas y skills cargados a tu servicio. Di «ayuda» cuando quieras ver lo que puedo hacer.`);
    return;
  }

  manejarComando(texto);
}

// ---------- Comandos de personalidad + enrutado a skills ----------
const CHISTES = [
  "¿Qué le dice un bit a otro bit? Nos vemos en el bus.",
  "Hay 10 tipos de personas: las que entienden binario y las que no.",
  "Mi creador me pidió un chiste sobre la nube… pero se me fue al cielo.",
  "¿Por qué los programadores confunden Halloween con Navidad? Porque OCT 31 es igual a DEC 25.",
];

async function manejarComando(texto) {
  const t = texto.toLowerCase();

  // --- Personalidad (respuestas instantáneas, sin IA) ---
  if (/^\s*(hola|buenos días|buenas tardes|buenas noches|qué tal|que tal)\b/.test(t)) {
    return responder(`${saludoPorHora()}, ${tratamiento()}. ¿En qué puedo ayudarte?`);
  }
  if (/(quién eres|quien eres|cómo te llamas|como te llamas|qué eres)/.test(t)) {
    return responder(`Soy JARVIS, tu asistente personal conectado a Claude, ${tratamiento()}. Estoy programado exclusivamente para servirte.`);
  }
  if (/(chiste|hazme reír|hazme reir|algo gracioso)/.test(t)) {
    return responder(CHISTES[Math.floor(Math.random() * CHISTES.length)]);
  }
  if (/(limpia|borra).*(chat|pantalla|conversación|conversacion)/.test(t)) {
    chat.innerHTML = "";
    historia.length = 0;
    return responder("Pantalla despejada.");
  }
  let m;
  if ((m = texto.match(/(?:llámame|llamame|cambia mi nombre a)\s+(.+)/i))) {
    cfg.nombre = m[1].trim();
    return responder(`Entendido. A partir de ahora te llamaré ${tratamiento()}.`);
  }
  if (/^(gracias|te pasaste|buen trabajo)/.test(t)) {
    return responder(`Siempre a tu servicio, ${tratamiento()}.`);
  }
  if (/(adiós|adios|hasta luego|apágate|apagate|descansa)/.test(t)) {
    return responder(`Hasta pronto, ${tratamiento()}. Estaré aquí cuando me necesites.`);
  }
  if (/\b(ayuda|qué puedes hacer|que puedes hacer|comandos|skills)\b/.test(t)) {
    return responder(
      "Mis skills disponibles:\n" +
      "• Búsqueda web — «busca quién ganó el clásico» (con IA)\n" +
      "• Tareas unificadas — «agrega tarea comprar repuestos» (Google), «agrega tarea de trabajo enviar informe» (Microsoft To Do), «mis tareas» (ambas)\n" +
      "• Google Calendar (calendario unificado) — «agenda reunión mañana a las 3» / «mi agenda»\n" +
      "• Recordatorios — «recuérdame mañana a las 8 tomar la pastilla»\n" +
      "• Clima real — «clima en Lima»\n" +
      "• Calculadora — «cuánto es 150 * 1.18»\n" +
      "• Monedas — «convierte 100 dólares a soles»\n" +
      "• Temporizador — «temporizador de 5 minutos»\n" +
      "• Web — «pon [canción]», «wikipedia sobre…»\n" +
      "• Chistes, «llámame [nombre]», «limpia el chat»\n" +
      (cfg.apiKey
        ? "Estoy conectado a Claude: pídeme lo que sea y combinaré las skills necesarias."
        : "Conéctame a Claude con tu clave API (⚙) para que pueda razonar, buscar en la web y combinar skills.")
    );
  }

  // --- Conectado a Claude: él decide qué skill usar ---
  if (cfg.apiKey) return preguntarIA(texto);

  // --- Sin clave: intento resolver con los patrones locales de las skills ---
  const local = skillLocal(texto);
  if (local) {
    setEstado("thinking", "Ejecutando skill");
    try {
      const resultado = await ejecutarSkill(local.skill.name, local.input);
      setEstado("idle", "En espera");
      return responder(resultado);
    } catch (e) {
      setEstado("idle", "En espera");
      return responder(`La skill «${local.skill.etiqueta}» reportó un problema: ${e.message}.`);
    }
  }

  // Hora/fecha sin IA (la skill no tiene patrón porque Claude la cubre)
  if (/\b(hora|fecha|qué día|que dia|día es hoy|dia es hoy)\b/.test(t)) {
    return responder(await ejecutarSkill("hora_fecha", {}));
  }

  responder(`No tengo ese comando en mis protocolos, ${tratamiento()}. Di «ayuda» para ver mis skills, o conéctame a Claude en configuración (⚙) para que pueda responder cualquier cosa.`);
}

function saludoPorHora() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

// ---------- Conexión a Claude con tool use (skills) ----------
const historia = []; // memoria de conversación entre turnos (solo texto)
const MAX_VUELTAS = 8; // límite del bucle agéntico

function promptSistema() {
  const ahora = new Date();
  const fechaHora = ahora.toLocaleString("es-PE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima";
  return (
    `Eres JARVIS, el asistente personal de ${cfg.nombre || "tu usuario"}. ` +
    `Dirígete siempre a él/ella como «${tratamiento()}», con el tono elegante, leal y ` +
    `ligeramente irónico del JARVIS de Iron Man. Responde siempre en español.\n\n` +
    `Fecha y hora actuales: ${fechaHora} (zona horaria ${tz}). Usa esto para calcular ` +
    `fechas relativas como «mañana», «el viernes» o «en dos horas».\n\n` +
    `Tienes skills reales — úsalas en lugar de estimar de memoria:\n` +
    `- web_search: busca en internet cuando el usuario pida buscar algo o pregunte por ` +
    `información actual (noticias, precios, resultados, datos recientes). Responde tú con ` +
    `lo encontrado; usa abrir_web solo si además quiere abrir la página.\n` +
    `- tareas: los pendientes del usuario viven en DOS sistemas: Google Tasks (personal) y ` +
    `Microsoft To Do (trabajo). Al listar consulta ambos (origen 'ambos'). Al crear, elige el ` +
    `origen según el contexto: 'microsoft' si es laboral, 'google' si es personal; pregunta ` +
    `solo si es realmente ambiguo.\n` +
    `- google_calendar: el CALENDARIO UNIFICADO. Todos los eventos, citas y recordatorios van ` +
    `SIEMPRE aquí, sin importar si la tarea asociada es de Google o de Microsoft. Para un ` +
    `recordatorio crea un evento con aviso_minutos. Si una tarea tiene fecha y hora concretas, ` +
    `crea la tarea en su sistema Y el evento asociado en google_calendar, mencionando en la ` +
    `descripción la tarea y su origen (p. ej. «Asociado a la tarea X de Microsoft To Do»).\n` +
    `- recordatorios: solo notas rápidas sin fecha.\n` +
    `- obtener_clima, calculadora, conversor_moneda, temporizador, hora_fecha, abrir_web.\n\n` +
    `Confirma cada acción realizada con sus datos clave (qué, cuándo). ` +
    `Tus respuestas se leen en voz alta: sé breve (2 a 4 frases), claro, sin formato markdown ` +
    `y sin leer URLs largas en voz alta.`
  );
}

async function llamarClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: promptSistema(),
      // Skills del navegador + búsqueda web server-side de Anthropic
      tools: [...HERRAMIENTAS_CLAUDE, { type: "web_search_20260209", name: "web_search" }],
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Error ${res.status}`);
  }
  return res.json();
}

async function preguntarIA(texto) {
  setEstado("thinking", "Procesando");
  historia.push({ role: "user", content: texto });

  // Copia de trabajo del turno: aquí van los bloques completos
  // (thinking/tool_use) que la API exige reenviar intactos.
  const messages = historia.slice(-16);

  try {
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const data = await llamarClaude(messages);

      if (data.stop_reason === "refusal") {
        historia.pop();
        setEstado("idle", "En espera");
        return responder("Lo siento, no puedo ayudarte con esa solicitud.");
      }

      // Reenviar el contenido completo preserva los bloques thinking/tool_use
      messages.push({ role: "assistant", content: data.content });

      // La búsqueda web server-side puede pausar el turno: se reenvía y continúa
      if (data.stop_reason === "pause_turn") {
        setEstado("thinking", "Buscando en la web");
        continue;
      }

      if (data.stop_reason === "tool_use") {
        const resultados = [];
        for (const bloque of data.content) {
          if (bloque.type !== "tool_use") continue;
          setEstado("thinking", `Skill: ${bloque.name}`);
          try {
            const salida = await ejecutarSkill(bloque.name, bloque.input);
            resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: salida });
          } catch (e) {
            resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: `Error: ${e.message}`, is_error: true });
          }
        }
        // Sin tool_use de cliente no se puede enviar content: [] (la API lo
        // rechaza); se reenvía tal cual, como en pause_turn
        if (resultados.length) messages.push({ role: "user", content: resultados });
        continue;
      }

      // Respuesta final
      const respuesta = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      historia.push({ role: "assistant", content: respuesta || "(sin texto)" });
      setEstado("idle", "En espera");
      return responder(respuesta || "Tarea completada.");
    }

    setEstado("idle", "En espera");
    responder("La tarea requirió demasiados pasos y la detuve por seguridad. Intenta dividirla en partes.");
  } catch (e) {
    historia.pop();
    setEstado("idle", "En espera");
    responder(`Hubo un problema con mi conexión a Claude, ${tratamiento()}: ${e.message}. Revisa la clave API en configuración.`);
  }
}

// ---------- Panel de configuración ----------
$("#btn-config").addEventListener("click", () => {
  $("#cfg-nombre").value = cfg.nombre;
  $("#cfg-trato").value = cfg.trato;
  $("#cfg-apikey").value = cfg.apiKey;
  $("#cfg-googleclient").value = cfg.googleClientId;
  $("#cfg-msclient").value = cfg.msClientId;
  cargarVoces();
  dlgConfig.showModal();
});

$("#cfg-guardar").addEventListener("click", () => {
  cfg.nombre = $("#cfg-nombre").value.trim();
  cfg.trato = $("#cfg-trato").value;
  cfg.apiKey = $("#cfg-apikey").value.trim();
  cfg.googleClientId = $("#cfg-googleclient").value.trim();
  cfg.msClientId = $("#cfg-msclient").value.trim();
  cfg.voz = $("#cfg-voz").value;
  esperandoNombre = !cfg.nombre;
  dlgConfig.close();
  responder(`Configuración actualizada, ${tratamiento()}.${cfg.apiKey ? " Conexión a Claude activa." : ""}`);
});

// Conexiones con Google y Microsoft (deben ocurrir con un clic del usuario
// para que el navegador permita la ventana de autorización)
$("#cfg-google-conectar").addEventListener("click", async () => {
  cfg.googleClientId = $("#cfg-googleclient").value.trim();
  const aviso = $("#cfg-google-estado");
  aviso.textContent = "Conectando…";
  try {
    await googleAuth.conectar();
    aviso.textContent = "✓ Google conectado (Tasks y Calendar)";
  } catch (e) {
    aviso.textContent = "✗ " + e.message;
  }
});

$("#cfg-ms-conectar").addEventListener("click", async () => {
  cfg.msClientId = $("#cfg-msclient").value.trim();
  msAuth.app = null; // por si el ID de aplicación cambió
  const aviso = $("#cfg-ms-estado");
  aviso.textContent = "Conectando…";
  try {
    await msAuth.conectar(true);
    aviso.textContent = "✓ Microsoft conectado (To Do)";
  } catch (e) {
    aviso.textContent = "✗ " + e.message;
  }
});

$("#cfg-cerrar").addEventListener("click", () => dlgConfig.close());

// ---------- Arranque ----------
window.addEventListener("load", () => {
  // PWA: permite instalar Jarvis como app y abrirlo sin conexión
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  iniciarLluvia();
  if (esperandoNombre) {
    agregarMensaje("Sistemas en línea. ¿Cómo debo llamarte?", "jarvis");
  } else {
    agregarMensaje(`${saludoPorHora()}, ${tratamiento()}. Pulsa el núcleo y habla.`, "jarvis");
  }
  // La síntesis de voz requiere interacción previa del usuario en la mayoría
  // de navegadores, por eso el saludo inicial solo se muestra en pantalla.
});
