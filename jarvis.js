/* ============================================================
   J.A.R.V.I.S. — Asistente personal de voz en español
   Conectado a Claude (API de Anthropic) con skills (tool use).
   Las skills están definidas en skills.js y también funcionan
   sin clave API mediante comandos de voz directos.
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const chat = $("#chat");
const entrada = $("#entrada");
const btnMic = $("#btn-mic");
const btnEnviar = $("#btn-enviar");
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

function pintarSkills() {
  const barra = $("#skills-bar");
  barra.innerHTML = "";
  for (const s of SKILLS) {
    const chip = document.createElement("span");
    chip.className = "skill-chip";
    chip.textContent = s.etiqueta;
    chip.title = s.description;
    barra.appendChild(chip);
  }
  const ia = document.createElement("span");
  ia.className = "skill-chip " + (cfg.apiKey ? "ia-on" : "ia-off");
  ia.textContent = cfg.apiKey ? "IA Claude ✓" : "IA Claude (sin clave)";
  ia.title = cfg.apiKey
    ? "Conectado a Claude: puede razonar y usar todas las skills por sí mismo"
    : "Configura tu clave API (⚙) para conectar Jarvis a Claude";
  barra.appendChild(ia);
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

  rec.onstart = () => {
    btnMic.classList.add("activo");
    setEstado("listening", "Escuchando");
  };
  rec.onend = () => {
    btnMic.classList.remove("activo");
    if (!reactor.classList.contains("thinking")) setEstado("idle", "En espera");
  };
  rec.onerror = (e) => {
    btnMic.classList.remove("activo");
    setEstado("idle", "En espera");
    if (e.error === "not-allowed") {
      agregarMensaje("⚠ Necesito permiso para usar el micrófono.", "jarvis");
    }
  };
  rec.onresult = (e) => {
    const texto = e.results[0][0].transcript.trim();
    procesarEntrada(texto);
  };
} else {
  btnMic.disabled = true;
  btnMic.title = "Tu navegador no soporta reconocimiento de voz (usa Chrome o Edge)";
}

btnMic.addEventListener("click", () => {
  if (!rec) return;
  speechSynthesis.cancel();
  try { rec.start(); } catch { rec.stop(); }
});

// ---------- Entrada por texto ----------
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
      "• Hora y fecha — «¿qué hora es?»\n" +
      "• Clima real — «clima en Lima»\n" +
      "• Calculadora — «cuánto es 150 * 1.18»\n" +
      "• Monedas — «convierte 100 dólares a soles»\n" +
      "• Temporizador — «temporizador de 5 minutos»\n" +
      "• Recordatorios — «recuérdame…» / «mis recordatorios»\n" +
      "• Web — «busca…», «pon [canción]», «wikipedia sobre…»\n" +
      "• Chistes, «llámame [nombre]», «limpia el chat»\n" +
      (cfg.apiKey
        ? "Además estoy conectado a Claude: pregúntame lo que sea y decidiré yo mismo qué skill usar."
        : "Conéctame a Claude con tu clave API (⚙) y podré razonar y combinar estas skills por mi cuenta.")
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
  return (
    `Eres JARVIS, el asistente personal de ${cfg.nombre || "tu usuario"}. ` +
    `Dirígete siempre a él/ella como «${tratamiento()}», con el tono elegante, leal y ` +
    `ligeramente irónico del JARVIS de Iron Man. Responde siempre en español. ` +
    `Tienes skills (herramientas) reales: clima, calculadora, conversor de monedas, ` +
    `temporizador, recordatorios, hora/fecha y apertura de webs. Úsalas siempre que la ` +
    `pregunta lo requiera en lugar de estimar de memoria (p. ej. usa obtener_clima para el ` +
    `clima real, calculadora para aritmética, hora_fecha para la hora actual). ` +
    `Tus respuestas se leen en voz alta: sé breve (2 a 4 frases), claro y sin formato markdown.`
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
      tools: HERRAMIENTAS_CLAUDE,
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
        messages.push({ role: "user", content: resultados });
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
  cargarVoces();
  dlgConfig.showModal();
});

$("#cfg-guardar").addEventListener("click", () => {
  cfg.nombre = $("#cfg-nombre").value.trim();
  cfg.trato = $("#cfg-trato").value;
  cfg.apiKey = $("#cfg-apikey").value.trim();
  cfg.voz = $("#cfg-voz").value;
  esperandoNombre = !cfg.nombre;
  pintarSkills();
  dlgConfig.close();
  responder(`Configuración actualizada, ${tratamiento()}.${cfg.apiKey ? " Conexión a Claude activa." : ""}`);
});

$("#cfg-cerrar").addEventListener("click", () => dlgConfig.close());

// ---------- Arranque ----------
window.addEventListener("load", () => {
  // PWA: permite instalar Jarvis como app y abrirlo sin conexión
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  pintarSkills();
  if (esperandoNombre) {
    agregarMensaje("Sistemas en línea. Soy JARVIS, tu asistente personal. Antes de empezar: ¿cómo debo llamarte?", "jarvis");
  } else {
    agregarMensaje(`${saludoPorHora()}, ${tratamiento()}. Skills cargadas y sistemas operativos. ¿En qué puedo servirte?`, "jarvis");
  }
  // La síntesis de voz requiere interacción previa del usuario en la mayoría
  // de navegadores, por eso el saludo inicial solo se muestra en pantalla.
});
