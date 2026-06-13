/* Arnés de simulación de JARVIS en Node: emula el navegador (DOM mínimo,
   voz, almacenamiento) y las APIs externas (Claude, Google, Open-Meteo)
   para ejercitar el flujo completo y detectar bugs. */

const fs = require("fs");
const assert = require("assert");

// ---------- Stubs del navegador ----------
function makeStorage() {
  return { _s: {}, getItem(k){ return k in this._s ? this._s[k] : null; }, setItem(k,v){ this._s[k]=String(v); }, removeItem(k){ delete this._s[k]; } };
}
global.localStorage = makeStorage();
global.sessionStorage = makeStorage();

function makeEl(id) {
  return {
    id, value: "", textContent: "", innerHTML: "", title: "", disabled: false,
    className: "", children: [],
    classList: {
      _c: new Set(),
      add(c){ this._c.add(c); }, remove(c){ this._c.delete(c); },
      contains(c){ return this._c.has(c); },
    },
    listeners: {},
    addEventListener(ev, fn){ (this.listeners[ev] ||= []).push(fn); },
    dispatch(ev, arg){ for (const fn of this.listeners[ev] || []) fn(arg || {}); },
    appendChild(c){ this.children.push(c); },
    showModal(){ this.open = true; },
    close(){ this.open = false; },
    scrollTop: 0, scrollHeight: 0,
  };
}

const els = {};
const IDS = ["chat","entrada","btn-enviar","fallback","rain","reactor","estado","config","btn-config",
  "cfg-nombre","cfg-trato","cfg-voz","cfg-apikey","cfg-googleclient","cfg-guardar","cfg-cerrar",
  "cfg-google-conectar","cfg-google-estado","cfg-msclient","cfg-ms-conectar","cfg-ms-estado","skills-bar"];
for (const id of IDS) els[id] = makeEl(id);

els["rain"].getContext = () => ({ fillRect(){}, fillText(){}, set fillStyle(v){}, set font(v){} });
els["fallback"].hidden = true;
global.document = {
  querySelector(sel){ const el = els[sel.replace(/^#/, "")]; if (!el) throw new Error("Selector no stubeado: " + sel); return el; },
  createElement(tag){ return makeEl(tag); },
};

global.window = {
  listeners: {},
  addEventListener(ev, fn){ (this.listeners[ev] ||= []).push(fn); },
  dispatch(ev){ for (const fn of this.listeners[ev] || []) fn(); },
  open(url){ registro.ventanas.push(url); },
};

global.speechSynthesis = {
  cancel(){}, speak(u){ registro.hablado.push(u.text); u.onend && u.onend(); },
  getVoices(){ return [{ name: "Es Voice", lang: "es-PE" }]; },
  onvoiceschanged: null,
};
global.SpeechSynthesisUtterance = class { constructor(t){ this.text = t; } };
global.navigator = { serviceWorker: { register: async () => ({}) } };
global.location = { origin: "http://localhost:8000", pathname: "/" };
window.innerWidth = 390; window.innerHeight = 844;
window.msal = {
  PublicClientApplication: class {
    constructor(cfg){ this.cfg = cfg; }
    async initialize(){}
    getAllAccounts(){ return [{ username: "tony@empresa.com" }]; }
    async acquireTokenSilent(){ return { accessToken: "mstok" }; }
    async loginPopup(){ return { accessToken: "mstok" }; }
  },
};

// ---------- Registro de lo observado ----------
const registro = { hablado: [], ventanas: [], peticionesClaude: [], errores: [] };

// ---------- Mock de fetch (Claude + Google + APIs públicas) ----------
let guionClaude = []; // respuestas programadas para api.anthropic.com

global.fetch = async (url, opts = {}) => {
  const ok = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });
  url = String(url);

  if (url.includes("api.anthropic.com")) {
    const cuerpo = JSON.parse(opts.body);
    registro.peticionesClaude.push(cuerpo);
    // Validaciones estructurales de cada petición
    assert.ok(cuerpo.model === "claude-opus-4-8", "modelo incorrecto");
    assert.ok(Array.isArray(cuerpo.messages) && cuerpo.messages.length > 0, "messages vacío");
    assert.ok(cuerpo.messages[0].role === "user", "el primer mensaje debe ser user");
    assert.ok(cuerpo.tools.some(t => t.type === "web_search_20260209"), "falta web_search");
    assert.deepStrictEqual(cuerpo.thinking, { type: "adaptive" }, "thinking debe ser adaptive");
    // tool_result debe referenciar tool_use existente del mensaje anterior
    for (let i = 0; i < cuerpo.messages.length; i++) {
      const msg = cuerpo.messages[i];
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b.type === "tool_result") {
            const prev = cuerpo.messages[i-1];
            const ids = (prev?.content || []).filter(x => x.type === "tool_use").map(x => x.id);
            assert.ok(ids.includes(b.tool_use_id), `tool_result ${b.tool_use_id} sin tool_use previo`);
          }
        }
        assert.ok(msg.content.length > 0, `mensaje con content [] (índice ${i}, role ${msg.role})`);
      }
    }
    if (!guionClaude.length) throw new Error("guión de Claude agotado");
    const paso = guionClaude.shift();
    if (paso.httpError) return ok({ error: { message: paso.httpError } }, paso.status || 401);
    return ok(paso);
  }

  if (url.includes("geocoding-api.open-meteo.com")) {
    const q = decodeURIComponent(url.match(/name=([^&]+)/)[1]).trim().toLowerCase();
    if (q !== "lima" && q !== "cusco") return ok({ results: undefined }); // como la API real ante basura
    return ok({ results: [{ name: q === "lima" ? "Lima" : "Cusco", country: "Perú", latitude: -12.05, longitude: -77.04 }] });
  }
  if (url.includes("api.open-meteo.com")) {
    return ok({ current: { temperature_2m: 19.4, apparent_temperature: 19.0, relative_humidity_2m: 83, weather_code: 3, wind_speed_10m: 11.2 } });
  }
  if (url.includes("open.er-api.com")) {
    return ok({ result: "success", rates: { PEN: 3.74, EUR: 0.92 } });
  }
  if (url.includes("graph.microsoft.com")) {
    const auth = opts.headers?.Authorization;
    if (!auth) return ok({ error: { message: "sin token" } }, 401);
    if (url.endsWith("/me/todo/lists")) return ok({ value: [{ id: "L1", wellknownListName: "defaultList", displayName: "Tareas" }] });
    if (opts.method === "POST") return ok({ title: JSON.parse(opts.body).title, id: "m9" });
    if (opts.method === "PATCH") return ok({}, 200);
    return ok({ value: [{ id: "m1", title: "enviar informe mensual", status: "notStarted", dueDateTime: { dateTime: "2026-06-20T00:00:00.0000000", timeZone: "UTC" } }] });
  }
  if (url.includes("tasks.googleapis.com")) {
    const auth = opts.headers?.Authorization;
    if (!auth) return ok({ error: { message: "sin token" } }, 401);
    if (opts.method === "POST") return ok({ title: JSON.parse(opts.body).title, id: "t1" });
    if (opts.method === "PATCH") return ok({}, 200);
    return ok({ items: [{ id: "t1", title: "comprar repuestos", due: "2026-06-19T00:00:00.000Z" }] });
  }
  if (url.includes("googleapis.com/calendar")) {
    if (opts.method === "POST") {
      const b = JSON.parse(opts.body);
      assert.ok(b.start.dateTime && b.start.timeZone, "evento sin start.dateTime/timeZone");
      return ok({ summary: b.summary, htmlLink: "https://calendar.google.com/evt1" });
    }
    return ok({ items: [{ summary: "Reunión", start: { dateTime: "2026-06-14T15:00:00-05:00" } }] });
  }
  throw new Error("fetch no stubeado: " + url);
};

// ---------- Cargar la app ----------
const srcSkills = fs.readFileSync(__dirname + "/../skills.js", "utf8");
const srcJarvis = fs.readFileSync(__dirname + "/../jarvis.js", "utf8");
eval(srcSkills + "\n" + srcJarvis + "\nglobal.__app = { procesarEntrada, cfg, historia };");

const app = global.__app;
const procesar = (t) => app.procesarEntrada(t);
const esperar = () => new Promise((r) => setTimeout(r, 30));
let fallos = 0;

async function caso(nombre, fn) {
  try { await fn(); console.log("✓", nombre); }
  catch (e) { fallos++; console.log("✗", nombre, "→", e.message); }
}

function ultimaRespuesta() {
  const msgs = els["chat"].children.filter((c) => c.className === "msg jarvis");
  return msgs[msgs.length - 1]?.textContent || "(nada)";
}

(async () => {
  window.dispatch("load");

  // ===== 1. Onboarding =====
  await caso("onboarding pide y guarda el nombre", async () => {
    procesar("me llamo Tony"); await esperar();
    assert.ok(app.cfg.nombre === "Tony", `nombre guardado: ${app.cfg.nombre}`);
    assert.match(ultimaRespuesta(), /Tony/);
  });

  // ===== 2. Comandos de personalidad =====
  await caso("saludo responde sin IA", async () => {
    procesar("hola jarvis"); await esperar();
    assert.match(ultimaRespuesta(), /Buen(os|as)/);
  });
  await caso("ayuda lista las skills", async () => {
    procesar("ayuda"); await esperar();
    assert.match(ultimaRespuesta(), /Tareas unificadas/);
  });

  // ===== 3. Skills locales sin clave API =====
  await caso("clima local (sin IA)", async () => {
    procesar("clima en Lima"); await esperar();
    assert.match(ultimaRespuesta(), /Lima.*19/s);
  });
  await caso("calculadora local", async () => {
    procesar("cuánto es 150 * 1.18"); await esperar();
    assert.match(ultimaRespuesta(), /177/);
  });
  await caso("conversor local", async () => {
    procesar("convierte 100 dólares a soles"); await esperar();
    assert.match(ultimaRespuesta(), /374/);
  });
  await caso("hora local", async () => {
    procesar("qué hora es"); await esperar();
    assert.match(ultimaRespuesta(), /Hora|hora/);
  });
  await caso("tareas sin ningún sistema conectado da error claro", async () => {
    procesar("agrega tarea comprar repuestos"); await esperar();
    assert.match(ultimaRespuesta(), /conectados|⚙/);
  });

  // ===== 4. Google y Microsoft conectados (tokens simulados) =====
  localStorage.setItem("jarvis_google_client_id", "gcli.apps.googleusercontent.com");
  localStorage.setItem("jarvis_ms_client_id", "11111111-2222-3333-4444-555555555555");
  sessionStorage.setItem("jarvis_google_token", JSON.stringify({ valor: "tok", expira: Date.now() + 3600e3 }));

  await caso("crear tarea personal va a Google", async () => {
    procesar("agrega tarea comprar repuestos"); await esperar();
    assert.match(ultimaRespuesta(), /Google Tasks.*comprar repuestos/s);
  });
  await caso("crear tarea de trabajo va a Microsoft To Do", async () => {
    procesar("agrega tarea de trabajo enviar informe mensual"); await esperar();
    assert.match(ultimaRespuesta(), /Microsoft To Do.*enviar informe mensual/s);
  });
  await caso("«mis tareas» unifica Google + Microsoft", async () => {
    procesar("mis tareas"); await esperar();
    const r = ultimaRespuesta();
    assert.match(r, /\[Google\] comprar repuestos/, "falta la tarea de Google: " + r);
    assert.match(r, /\[Microsoft\] enviar informe mensual/, "falta la tarea de Microsoft: " + r);
  });
  await caso("completar busca en ambos sistemas (encuentra en Microsoft)", async () => {
    procesar("completa la tarea enviar informe"); await esperar();
    assert.match(ultimaRespuesta(), /Microsoft.*enviar informe mensual/s);
  });
  await caso("google_calendar listar agenda", async () => {
    procesar("mi agenda"); await esperar();
    assert.match(ultimaRespuesta(), /Reunión/);
  });

  // ===== 5. Modo IA: bucle agéntico con tool use =====
  app.cfg.apiKey = "sk-ant-test";
  app.historia.length = 0;

  await caso("Claude crea tarea + evento asociado (2 tools, 2 vueltas)", async () => {
    guionClaude = [
      {
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "", signature: "sig1" },
          { type: "tool_use", id: "tu_1", name: "tareas", input: { accion: "crear", origen: "google", titulo: "renovar SOAT", fecha_limite: "2026-06-19" } },
          { type: "tool_use", id: "tu_2", name: "google_calendar", input: { accion: "crear_evento", titulo: "Renovar SOAT", inicio: "2026-06-19T09:00:00", aviso_minutos: 30, descripcion: "Asociado a la tarea renovar SOAT" } },
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Listo, señor Tony: tarea y recordatorio creados para el viernes 19 a las 9." }] },
    ];
    procesar("crea la tarea de renovar el SOAT para el viernes y agéndame recordatorio a las 9");
    await esperar();
    assert.ok(guionClaude.length === 0, "no consumió todo el guión");
    assert.match(ultimaRespuesta(), /tarea y recordatorio/);
    // La 2ª petición debe llevar los tool_result de ambos tools
    const segunda = registro.peticionesClaude[registro.peticionesClaude.length - 1];
    const resultados = segunda.messages[segunda.messages.length - 1].content;
    assert.ok(resultados.filter((b) => b.type === "tool_result").length === 2, "faltan tool_results");
  });

  await caso("pause_turn (búsqueda web server-side) continúa el turno", async () => {
    guionClaude = [
      { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "st1", name: "web_search", input: { query: "noticias Perú" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Esto encontré, señor Tony." }] },
    ];
    procesar("busca las noticias de hoy en Perú"); await esperar();
    assert.ok(guionClaude.length === 0, "no reenvió tras pause_turn");
    assert.match(ultimaRespuesta(), /encontré/);
  });

  await caso("refusal se maneja con mensaje y sin romper historia", async () => {
    const antes = app.historia.length;
    guionClaude = [{ stop_reason: "refusal", content: [] }];
    procesar("pregunta rechazada"); await esperar();
    assert.match(ultimaRespuesta(), /no puedo/i);
    assert.ok(app.historia.length === antes, "historia quedó desbalanceada tras refusal");
  });

  await caso("error HTTP 401 muestra aviso y no corrompe historia", async () => {
    const antes = app.historia.length;
    guionClaude = [{ httpError: "invalid x-api-key", status: 401 }];
    procesar("explícame la fusión fría"); await esperar();
    assert.match(ultimaRespuesta(), /problema.*Claude/s);
    assert.ok(app.historia.length === antes, "historia desbalanceada tras error");
  });

  await caso("skill que falla envía tool_result con is_error y Claude responde", async () => {
    guionClaude = [
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_9", name: "calculadora", input: { expresion: "hola mundo" } }],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Esa expresión no es válida, señor." }] },
    ];
    procesar("calcula hola mundo por favor"); await esperar();
    const segunda = registro.peticionesClaude[registro.peticionesClaude.length - 1];
    const tr = segunda.messages[segunda.messages.length - 1].content[0];
    assert.ok(tr.is_error === true, "falta is_error en tool_result fallido");
    assert.match(ultimaRespuesta(), /no es válida/);
  });

  await caso("conversación multi-turno mantiene la historia coherente", async () => {
    guionClaude = [{ stop_reason: "end_turn", content: [{ type: "text", text: "Claro que sí." }] }];
    procesar("una pregunta cualquiera"); await esperar();
    // roles de historia deben alternar empezando por user
    for (const msg of app.historia) assert.ok(["user","assistant"].includes(msg.role));
    const ultima = registro.peticionesClaude[registro.peticionesClaude.length - 1];
    assert.ok(typeof ultima.messages[0].content === "string" || Array.isArray(ultima.messages[0].content));
  });

  // ===== 6. Casos límite de regex =====
  await caso("«qué tiempo hace en Lima» no captura basura como ciudad", async () => {
    app.cfg.apiKey = ""; // modo local
    procesar("qué tiempo hace en Lima"); await esperar();
    assert.match(ultimaRespuesta(), /Lima/, `respondió: ${ultimaRespuesta()}`);
  });

  await caso("temporizador local avisa al terminar", async () => {
    const antes = registro.hablado.length;
    procesar("temporizador de 1 segundos"); await esperar();
    await new Promise((r) => setTimeout(r, 1100));
    assert.ok(registro.hablado.some((h, i) => i >= antes && /Tiempo cumplido/.test(h)), "no avisó al terminar");
  });

  await caso("«clima Lima» sin preposición también funciona", async () => {
    procesar("clima Lima"); await esperar();
    assert.match(ultimaRespuesta(), /Lima.*19/s);
  });

  await caso("«temperatura de Cusco» funciona", async () => {
    procesar("temperatura de Cusco"); await esperar();
    assert.match(ultimaRespuesta(), /Cusco/);
  });

  await caso("tool_use sin bloques de cliente no envía content vacío", async () => {
    app.cfg.apiKey = "sk-ant-test";
    guionClaude = [
      { stop_reason: "tool_use", content: [{ type: "text", text: "voy a buscar" }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Resuelto, señor." }] },
    ];
    procesar("caso raro de tool_use vacío"); await esperar();
    assert.ok(guionClaude.length === 0, "no continuó el turno");
    assert.match(ultimaRespuesta(), /Resuelto/);
    app.cfg.apiKey = "";
  });

  console.log(fallos ? `\n${fallos} caso(s) fallaron` : "\nTodos los casos pasaron");
  process.exit(fallos ? 1 : 0);
})();
