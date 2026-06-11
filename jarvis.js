/* ============================================================
   J.A.R.V.I.S. — Asistente personal de voz en español
   Comandos integrados + modo IA opcional (API de Claude)
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
  get recordatorios() { return JSON.parse(localStorage.getItem("jarvis_recordatorios") || "[]"); },
  set recordatorios(v) { localStorage.setItem("jarvis_recordatorios", JSON.stringify(v)); },
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
    responder(`Un placer, ${tratamiento()}. Sistemas configurados a tu servicio. Di «ayuda» cuando quieras ver lo que puedo hacer.`);
    return;
  }

  manejarComando(texto);
}

// ---------- Comandos integrados ----------
const CHISTES = [
  "¿Qué le dice un bit a otro bit? Nos vemos en el bus.",
  "Hay 10 tipos de personas: las que entienden binario y las que no.",
  "Mi creador me pidió un chiste sobre la nube… pero se me fue al cielo.",
  "¿Por qué los programadores confunden Halloween con Navidad? Porque OCT 31 es igual a DEC 25.",
];

function manejarComando(texto) {
  const t = texto.toLowerCase();

  // Saludos
  if (/\b(hola|buenos días|buenas tardes|buenas noches|qué tal)\b/.test(t)) {
    return responder(`${saludoPorHora()}, ${tratamiento()}. ¿En qué puedo ayudarte?`);
  }

  // Identidad
  if (/(quién eres|quien eres|cómo te llamas|como te llamas|qué eres)/.test(t)) {
    return responder(`Soy JARVIS, tu asistente personal, ${tratamiento()}. Estoy programado exclusivamente para servirte.`);
  }

  // Hora y fecha
  if (/\b(hora)\b/.test(t)) {
    const h = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
    return responder(`Son las ${h}, ${tratamiento()}.`);
  }
  if (/\b(fecha|día es hoy|dia es hoy|qué día|que dia)\b/.test(t)) {
    const f = new Date().toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return responder(`Hoy es ${f}.`);
  }

  // Búsquedas y sitios
  let m;
  if ((m = t.match(/busca(?:r)?(?: en google)?\s+(.+)/))) {
    window.open("https://www.google.com/search?q=" + encodeURIComponent(m[1]), "_blank");
    return responder(`Buscando «${m[1]}» en Google, ${tratamiento()}.`);
  }
  if ((m = t.match(/(?:pon|reproduce|busca en youtube)\s+(.+)/))) {
    window.open("https://www.youtube.com/results?search_query=" + encodeURIComponent(m[1]), "_blank");
    return responder(`Buscando «${m[1]}» en YouTube.`);
  }
  if (/abre youtube/.test(t)) { window.open("https://youtube.com", "_blank"); return responder("Abriendo YouTube."); }
  if (/abre google/.test(t)) { window.open("https://google.com", "_blank"); return responder("Abriendo Google."); }
  if ((m = t.match(/wikipedia\s+(?:de\s+|sobre\s+)?(.+)/))) {
    window.open("https://es.wikipedia.org/wiki/Special:Search?search=" + encodeURIComponent(m[1]), "_blank");
    return responder(`Consultando Wikipedia sobre «${m[1]}».`);
  }

  // Recordatorios
  if ((m = texto.match(/(?:recuérdame|recuerdame|recordatorio|anota|apunta)\s+(?:que\s+)?(.+)/i))) {
    const lista = cfg.recordatorios;
    lista.push({ texto: m[1], fecha: new Date().toLocaleString("es-PE") });
    cfg.recordatorios = lista;
    return responder(`Anotado, ${tratamiento()}: «${m[1]}».`);
  }
  if (/(mis recordatorios|qué anotaste|que anotaste|mis notas)/.test(t)) {
    const lista = cfg.recordatorios;
    if (!lista.length) return responder("No tienes recordatorios pendientes.");
    const detalle = lista.map((r, i) => `${i + 1}. ${r.texto} (${r.fecha})`).join("\n");
    return responder(`Tienes ${lista.length} recordatorio(s):\n${detalle}`);
  }
  if (/(borra|elimina|limpia).*(recordatorios|notas)/.test(t)) {
    cfg.recordatorios = [];
    return responder("Recordatorios eliminados.");
  }

  // Humor
  if (/(chiste|hazme reír|hazme reir|algo gracioso)/.test(t)) {
    return responder(CHISTES[Math.floor(Math.random() * CHISTES.length)]);
  }

  // Utilidades
  if (/(limpia|borra).*(chat|pantalla|conversación|conversacion)/.test(t)) {
    chat.innerHTML = "";
    historia.length = 0;
    return responder("Pantalla despejada.");
  }
  if ((m = texto.match(/(?:llámame|llamame|mi nombre es|cambia mi nombre a)\s+(.+)/i))) {
    cfg.nombre = m[1].trim();
    return responder(`Entendido. A partir de ahora te llamaré ${tratamiento()}.`);
  }
  if (/(gracias|te pasaste|buen trabajo)/.test(t)) {
    return responder(`Siempre a tu servicio, ${tratamiento()}.`);
  }
  if (/(adiós|adios|hasta luego|apágate|apagate|descansa)/.test(t)) {
    return responder(`Hasta pronto, ${tratamiento()}. Estaré aquí cuando me necesites.`);
  }

  // Ayuda
  if (/\b(ayuda|qué puedes hacer|que puedes hacer|comandos)\b/.test(t)) {
    return responder(
      "Puedo ayudarte con:\n" +
      "• «¿Qué hora es?» / «¿Qué día es hoy?»\n" +
      "• «Busca [algo]» — búsqueda en Google\n" +
      "• «Pon [canción]» / «Abre YouTube»\n" +
      "• «Wikipedia sobre [tema]»\n" +
      "• «Recuérdame [algo]» / «Mis recordatorios»\n" +
      "• «Cuéntame un chiste»\n" +
      "• «Llámame [nombre]» / «Limpia el chat»\n" +
      (cfg.apiKey
        ? "• Y cualquier otra pregunta: la responderé con mi módulo de IA."
        : "• Configura una clave API de Claude (⚙) y podré responder cualquier pregunta.")
    );
  }

  // Sin coincidencia → modo IA o mensaje por defecto
  if (cfg.apiKey) return preguntarIA(texto);
  responder(`No tengo ese comando en mis protocolos, ${tratamiento()}. Di «ayuda» para ver lo que puedo hacer, o activa el modo IA en configuración (⚙).`);
}

function saludoPorHora() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

// ---------- Modo IA (API de Claude) ----------
const historia = [];

async function preguntarIA(texto) {
  setEstado("thinking", "Procesando");
  historia.push({ role: "user", content: texto });

  try {
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
        system:
          `Eres JARVIS, el asistente personal de ${cfg.nombre || "tu usuario"}. ` +
          `Dirígete siempre a él/ella como «${tratamiento()}», con el tono elegante, leal y ` +
          `ligeramente irónico del JARVIS de Iron Man. Responde siempre en español. ` +
          `Tus respuestas se leen en voz alta: sé breve (2 a 4 frases), claro y sin formato markdown.`,
        messages: historia.slice(-12),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Error ${res.status}`);
    }

    const data = await res.json();

    if (data.stop_reason === "refusal") {
      historia.pop();
      setEstado("idle", "En espera");
      return responder("Lo siento, no puedo ayudarte con esa solicitud.");
    }

    const respuesta = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    historia.push({ role: "assistant", content: respuesta });
    setEstado("idle", "En espera");
    responder(respuesta || "No obtuve respuesta del módulo de IA.");
  } catch (e) {
    historia.pop();
    setEstado("idle", "En espera");
    responder(`Hubo un problema con el módulo de IA, ${tratamiento()}: ${e.message}. Revisa la clave API en configuración.`);
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
  dlgConfig.close();
  responder(`Configuración actualizada, ${tratamiento()}.`);
});

$("#cfg-cerrar").addEventListener("click", () => dlgConfig.close());

// ---------- Arranque ----------
window.addEventListener("load", () => {
  if (esperandoNombre) {
    agregarMensaje("Sistemas en línea. Soy JARVIS, tu asistente personal. Antes de empezar: ¿cómo debo llamarte?", "jarvis");
  } else {
    agregarMensaje(`${saludoPorHora()}, ${tratamiento()}. Todos los sistemas operativos. ¿En qué puedo servirte?`, "jarvis");
  }
  // La síntesis de voz requiere interacción previa del usuario en la mayoría
  // de navegadores, por eso el saludo inicial solo se muestra en pantalla.
});
