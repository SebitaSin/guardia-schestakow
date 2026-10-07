import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { appendAudit } from "./store.mjs";
import { readPrivateContacts, upsertPrivateContact } from "./private-contacts.mjs";
import { deletePrivateLocation, normalizeSolidario, readPrivateLocations, setSolidario, upsertPrivateLocation } from "./private-locations.mjs";
import { geocodeWithGoogle } from "./maps.mjs";
const PAGE = readFileSync(new URL("./autogestion-page.html", import.meta.url), "utf8");
const AUTOGESTION_SCRIPT = readFileSync(new URL("./autogestion-client.js", import.meta.url), "utf8");
const autogestionPage = () => PAGE;

/**
 * Autogestión del personal: una página pública (sin usuario ni contraseña) donde cada persona, con su DNI,
 * actualiza domicilio, teléfono, cómo va al hospital y si puede llevar compañeros en una catástrofe.
 *
 * Reglas de seguridad:
 * - Saber un DNI no muestra domicilio ni teléfono: para verlos hay que acertar los últimos 4 números del celular registrado.
 * - Un dato ya registrado sólo se reemplaza solo si la persona probó ser ella (esos 4 números, o escribir el mismo celular).
 *   Si no, el cambio queda pendiente para que Dirección lo acepte o lo descarte.
 * - Responder dos veces pisa la respuesta anterior de esa misma persona: no se duplica.
 */

const ACTOR = "autogestión";
const MODES = new Set(["CAR", "MOTORCYCLE", "BICYCLE", "PUBLIC_TRANSPORT", "WALKING", "OTHER"]);
/** Dónde puede ayudar alguien fuera de su servicio en una inundación, terremoto o accidente con muchas víctimas. */
export const AYUDA = {
  triage: "Recepción y clasificación de heridos (triage)",
  guardia: "Guardia y emergencias",
  criticos: "Pacientes críticos (terapia intensiva)",
  quirofano: "Quirófano, trauma y quemados",
  pediatria: "Niños y recién nacidos",
  internacion: "Cuidado de pacientes internados",
  traslado: "Traslado de pacientes (camilla, ambulancia, evacuación)",
  sangre: "Laboratorio y banco de sangre",
  farmacia: "Farmacia, insumos y oxígeno",
  familias: "Atención a familiares, lista de víctimas y contención",
  logistica: "Luz, agua, mantenimiento y comunicaciones",
  apoyo: "Cocina, limpieza y lo que haga falta",
};
const SESSION_MS = 30 * 60_000;
const DAY_MS = 24 * 3_600_000;

function storePath(dataDir) { return join(dataDir, "continuidad", "autogestion.enc.json"); }
function keyFrom(secret) {
  if (String(secret ?? "").length < 32) throw new Error("autogestion_secret_invalid");
  return createHash("sha256").update(`schestakow-autogestion:${secret}`).digest();
}
const EMPTY = () => ({ respuestas: {}, pendientes: [], geocode: { dia: "", n: 0 } });

export function readAutogestion(dataDir, secret) {
  const path = storePath(dataDir);
  if (!existsSync(path)) return EMPTY();
  const box = JSON.parse(readFileSync(path, "utf8"));
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]);
  return { ...EMPTY(), ...JSON.parse(plain.toString("utf8")) };
}

function writeAutogestion(dataDir, secret, store) {
  const path = storePath(dataDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(store), "utf8"), cipher.final()]);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

const digits = (value) => String(value ?? "").replace(/\D/g, "");
const fold = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const NOISE = new Set(["AV", "AVDA", "AVENIDA", "CALLE", "B", "BO", "BARRIO", "N", "NRO", "NUMERO", "SAN", "RAFAEL", "MENDOZA", "ARGENTINA"]);
/** Dos formas de escribir el mismo domicilio ("Av. Mitre 120" y "mitre 120, San Rafael") cuentan como iguales. */
export const addressKey = (value) => fold(value).split(" ").filter((word) => word && !NOISE.has(word)).sort().join(" ");
/** Un campo puede traer más de un teléfono ("2604-111111 / 2604-222222"). */
export const phonesOf = (value) => String(value ?? "").split(/[/,;]|\sy\s/i).map(digits).filter((item) => item.length >= 6);
export const samePhone = (a, b) => phonesOf(a).some((x) => phonesOf(b).some((y) => x.slice(-7) === y.slice(-7)));
/** Para que la persona se reconozca sin exponer el nombre completo: primera palabra e iniciales. */
export const maskedName = (name) => String(name ?? "").replace(/,/g, " ").split(/\s+/).filter(Boolean).map((word, index) => (index === 0 ? word : `${word[0]}.`)).join(" ");

function cleanInput(input) {
  const address = String(input?.address ?? "").replace(/\s+/g, " ").trim();
  const phone = String(input?.phone ?? "").replace(/\s+/g, " ").trim();
  const transportMode = String(input?.transportMode ?? "");
  if (address.length < 5 || address.length > 240) throw new Error("direccion");
  if (phone.length > 40 || /[^\d\s+()./-]/.test(phone) || digits(phone).length < 8 || digits(phone).length > 15) throw new Error("telefono");
  if (!MODES.has(transportMode)) throw new Error("transporte");
  const servicio = String(input?.servicio ?? "").replace(/\s+/g, " ").trim();
  const rol = String(input?.rol ?? "").replace(/\s+/g, " ").trim();
  if (servicio.length < 2 || servicio.length > 120) throw new Error("servicio");
  if (rol.length < 2 || rol.length > 120) throw new Error("rol");
  const ayuda = [...new Set(Array.isArray(input?.ayuda) ? input.ayuda.map(String).filter((key) => Object.hasOwn(AYUDA, key)) : [])];
  const vehiculoSeguro = transportMode === "CAR" && input?.vehiculoSeguro === true;
  return { address, phone, transportMode, servicio, rol, ayuda, vehiculoSeguro, dispuesto: vehiculoSeguro && input?.dispuesto === true, lugares: Number(input?.lugares) || 1, necesitaTraslado: !vehiculoSeguro && input?.necesitaTraslado === true };
}

export function autogestionConfig() {
  try { return { enabled: true, geocodePerDay: 200, ...JSON.parse(readFileSync(new URL("./autogestion-config.json", import.meta.url), "utf8")) }; }
  catch { return { enabled: true, geocodePerDay: 200 }; }
}

export function createAutogestion({ dataDir, secret, maps = { serverKey: "" }, fetchImpl = fetch, config = autogestionConfig(), now = () => Date.now() }) {
  const sessions = new Map(); // token -> { dni, ids, verified, exp }
  const hits = new Map(); // clave -> { n, until }
  const mutate = (fn) => { const store = readAutogestion(dataDir, secret); const out = fn(store); writeAutogestion(dataDir, secret, store); return out; };

  function limited(key, max, windowMs) {
    const item = hits.get(key);
    if (!item || item.until < now()) { hits.set(key, { n: 1, until: now() + windowMs }); return false; }
    item.n += 1;
    return item.n > max;
  }
  function sweep() {
    if (sessions.size + hits.size < 5_000) return;
    for (const [key, item] of sessions) if (item.exp < now()) sessions.delete(key);
    for (const [key, item] of hits) if (item.until < now()) hits.delete(key);
  }
  function session(token) {
    const item = sessions.get(String(token ?? ""));
    if (!item || item.exp < now()) throw new Error("sesion");
    return item;
  }

  function progress(contacts, service) {
    const store = readAutogestion(dataDir, secret);
    const withDni = contacts.filter((item) => item.dni);
    const answered = (item) => Boolean(store.respuestas[item.staffId]);
    const mine = service ? withDni.filter((item) => item.service === service) : [];
    return { total: withDni.length, respondieron: withDni.filter(answered).length, servicio: service ? { nombre: service, total: mine.length, respondieron: mine.filter(answered).length } : null };
  }

  async function locate(staffId, address, transportMode) {
    if (!maps.serverKey || !address) return null;
    const allowed = mutate((store) => {
      const dia = new Date(now()).toISOString().slice(0, 10);
      if (store.geocode.dia !== dia) store.geocode = { dia, n: 0 };
      if (store.geocode.n >= config.geocodePerDay) return false;
      store.geocode.n += 1;
      return true;
    });
    if (!allowed) return null;
    try {
      const point = await geocodeWithGoogle(address, maps, fetchImpl);
      return upsertPrivateLocation(dataDir, secret, { staffId, address: point.address, lat: point.lat, lng: point.lng, transportMode }, ACTOR);
    } catch { return null; }
  }

  /** Aplica la respuesta de una persona de la nómina. Devuelve qué quedó guardado y qué quedó para revisar. */
  async function apply(staffId, data, verified) {
    const contact = readPrivateContacts(dataDir, secret).find((item) => item.staffId === staffId);
    if (!contact) throw new Error("persona");
    const trusted = verified || samePhone(data.phone, contact.phone);
    const patch = { staffId, transportMode: data.transportMode };
    if (data.rol && data.rol !== contact.role) patch.role = data.rol;
    const review = {};
    const addressChanged = addressKey(data.address) !== addressKey(contact.address);
    if (addressChanged) { if (trusted || !contact.address) patch.address = data.address; else review.address = data.address; }
    if (!samePhone(data.phone, contact.phone)) { if (trusted || !contact.phone) patch.phone = data.phone; else review.phone = data.phone; }
    if (data.servicio && fold(data.servicio) !== fold(contact.service)) { if (trusted || !contact.service) patch.service = data.servicio; else review.service = data.servicio; }
    const saved = upsertPrivateContact(dataDir, secret, patch, ACTOR);

    let point = readPrivateLocations(dataDir, secret).find((item) => item.staffId === staffId) ?? null;
    if (patch.address !== undefined && point) { deletePrivateLocation(dataDir, secret, staffId); point = null; } // el punto viejo ya no es su domicilio
    if (!point) point = await locate(staffId, saved.address, data.transportMode);
    if (point) setSolidario(dataDir, secret, { staffId, ...data }, ACTOR);

    const pending = Object.keys(review).length > 0;
    mutate((store) => {
      const before = store.respuestas[staffId];
      store.respuestas[staffId] = { en: new Date(now()).toISOString(), verificado: trusted, veces: (before?.veces ?? 0) + 1, ubicado: Boolean(point), ayuda: data.ayuda ?? [], declaracion: { transportMode: data.transportMode, vehiculoSeguro: data.vehiculoSeguro, dispuesto: data.dispuesto, lugares: data.lugares, necesitaTraslado: data.necesitaTraslado } };
      store.pendientes = store.pendientes.filter((item) => item.staffId !== staffId);
      if (pending) store.pendientes.push({ id: randomBytes(8).toString("hex"), tipo: "cambio", staffId, nombre: contact.name ?? "", servicio: contact.service ?? "", datos: data, campos: Object.keys(review), en: new Date(now()).toISOString() });
    });
    appendAudit(dataDir, { actor: ACTOR, action: "autogestion_guardado", kind: "staff_self_report", staffId, verificado: trusted, campos: Object.keys(patch).filter((key) => key !== "staffId"), aRevisar: Object.keys(review), ubicado: Boolean(point) });
    return { pending, located: Boolean(point) };
  }

  async function publicApi(path, body, ip) {
    sweep();
    if (path === "buscar") {
      if (limited(`b:${ip}`, 80, 10 * 60_000) || limited(`bd:${ip}`, 800, DAY_MS)) throw new Error("limite");
      const dni = digits(body.dni).replace(/^0+/, "");
      if (dni.length < 6 || dni.length > 9) throw new Error("dni");
      const contacts = readPrivateContacts(dataDir, secret);
      const mine = contacts.filter((item) => digits(item.dni).replace(/^0+/, "") === dni);
      const token = randomBytes(18).toString("base64url");
      sessions.set(token, { dni, ids: mine.map((item) => item.staffId), verified: false, exp: now() + SESSION_MS });
      const servicios = [...new Set(contacts.map((item) => item.service).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
      if (!mine.length) return { token, encontrado: false, servicios };
      const answered = readAutogestion(dataDir, secret).respuestas[mine[0].staffId];
      return { token, encontrado: true, nombre: maskedName(mine[0].name), servicio: [...new Set(mine.map((item) => item.service).filter(Boolean))].join(" · "), servicioActual: mine[0].service ?? "", servicios, pideClave: mine.some((item) => phonesOf(item.phone).length > 0), yaRespondio: answered?.en ?? null };
    }
    if (path === "verificar") {
      const current = session(body.token);
      if (!current.ids.length) throw new Error("sesion");
      const lock = hits.get(`v:${current.dni}`);
      if (lock && lock.until > now() && lock.n >= 5) throw new Error("limite");
      const last4 = digits(body.ultimos4);
      const contacts = readPrivateContacts(dataDir, secret).filter((item) => current.ids.includes(item.staffId));
      if (last4.length !== 4 || !contacts.some((item) => phonesOf(item.phone).some((phone) => phone.slice(-4) === last4))) {
        limited(`v:${current.dni}`, 5, DAY_MS);
        throw new Error("clave");
      }
      current.verified = true;
      const contact = contacts[0];
      const point = readPrivateLocations(dataDir, secret).find((item) => item.staffId === contact.staffId);
      const mode = point?.transportMode && point.transportMode !== "UNKNOWN" ? point.transportMode : contact.transportMode && contact.transportMode !== "UNKNOWN" ? contact.transportMode : "";
      return { address: contact.address ?? "", phone: contact.phone ?? "", rol: contact.role ?? "", ayuda: readAutogestion(dataDir, secret).respuestas[contact.staffId]?.ayuda ?? null, transportMode: mode, solidario: point?.solidario ? { vehiculoSeguro: point.solidario.vehiculoSeguro, dispuesto: point.solidario.dispuesto, lugares: point.solidario.lugares, necesitaTraslado: point.solidario.necesitaTraslado } : null };
    }
    if (path === "guardar") {
      if (limited(`g:${ip}`, 60, 3_600_000)) throw new Error("limite");
      const current = session(body.token);
      const data = cleanInput(body);
      let pending = false;
      let service = "";
      if (current.ids.length) {
        for (const staffId of current.ids) pending = (await apply(staffId, data, current.verified)).pending || pending;
        service = readPrivateContacts(dataDir, secret).find((item) => item.staffId === current.ids[0])?.service ?? "";
      } else {
        const nombre = String(body.nombre ?? "").replace(/\s+/g, " ").trim();
        const servicio = data.servicio;
        if (nombre.length < 5 || nombre.length > 160) throw new Error("nombre");
        pending = true;
        mutate((store) => {
          if (store.pendientes.length >= 3_000) throw new Error("limite");
          store.pendientes = store.pendientes.filter((item) => item.dni !== current.dni);
          store.pendientes.push({ id: randomBytes(8).toString("hex"), tipo: "nueva", dni: current.dni, nombre, servicio, datos: data, campos: ["persona"], en: new Date(now()).toISOString() });
        });
        appendAudit(dataDir, { actor: ACTOR, action: "autogestion_persona_fuera_de_nomina", kind: "staff_self_report" });
      }
      sessions.delete(String(body.token));
      return { ok: true, revision: pending, progreso: progress(readPrivateContacts(dataDir, secret), service) };
    }
    throw new Error("ruta");
  }

  const STATUS = { limite: 429, sesion: 401, clave: 403, ruta: 404 };

  return {
    enabled: config.enabled !== false,
    isPublicPath: (pathname) => pathname === "/mis-datos" || pathname === "/mis-datos.js" || pathname.startsWith("/api/autogestion/publico/"),

    /** Atiende las rutas públicas. `tools` trae send, json y readBody del servidor. */
    async handlePublic(req, res, url, ip, { send, json, readBody }) {
      if (config.enabled === false) return send(res, 404, "not found");
      if (url.pathname === "/mis-datos" && req.method === "GET") return send(res, 200, autogestionPage(), "text/html; charset=utf-8");
      if (url.pathname === "/mis-datos.js" && req.method === "GET") return send(res, 200, AUTOGESTION_SCRIPT, "text/javascript; charset=utf-8");
      if (req.method !== "POST") return json(res, 405, { error: "method" });
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: "cross_site_request_blocked" });
      try {
        const body = JSON.parse((await readBody(req, 4_096)).toString("utf8"));
        return json(res, 200, await publicApi(url.pathname.slice("/api/autogestion/publico/".length), body ?? {}, ip));
      } catch (error) {
        const code = error instanceof SyntaxError ? "datos" : String(error?.message ?? "error");
        const known = ["rol", "limite", "sesion", "clave", "ruta", "dni", "direccion", "telefono", "transporte", "nombre", "servicio", "datos", "persona"].includes(code);
        if (!known) appendAudit(dataDir, { actor: "system", action: "autogestion_error", kind: "system", error: error instanceof Error ? error.name : "Error" });
        return json(res, known ? STATUS[code] ?? 400 : 500, { error: known ? code : "servicio" });
      }
    },

    /** Para Dirección: avance, pendientes de revisar y quiénes respondieron pero no se pudieron ubicar en el mapa. */
    estado() {
      const contacts = readPrivateContacts(dataDir, secret);
      const points = new Map(readPrivateLocations(dataDir, secret).map((item) => [item.staffId, item]));
      // Si Dirección ubicó después el domicilio en el mapa, la declaración guardada se aplica ahora.
      const late = Object.entries(readAutogestion(dataDir, secret).respuestas).filter(([staffId, item]) => !item.ubicado && points.has(staffId));
      for (const [staffId, item] of late) setSolidario(dataDir, secret, { staffId, ...item.declaracion }, ACTOR);
      if (late.length) mutate((store) => { for (const [staffId] of late) if (store.respuestas[staffId]) store.respuestas[staffId].ubicado = true; });
      const store = readAutogestion(dataDir, secret);
      const byId = new Map(contacts.map((item) => [item.staffId, item]));
      const withDni = contacts.filter((item) => item.dni);
      const services = new Map();
      for (const item of withDni) {
        const row = services.get(item.service ?? "") ?? { servicio: item.service ?? "Sin servicio", total: 0, respondieron: 0 };
        row.total += 1;
        if (store.respuestas[item.staffId]) row.respondieron += 1;
        services.set(item.service ?? "", row);
      }
      const answers = Object.entries(store.respuestas).filter(([staffId]) => byId.has(staffId));
      return {
        total: withDni.length, respondieron: answers.length, verificados: answers.filter(([, item]) => item.verificado).length,
        sinUbicar: answers.filter(([, item]) => !item.ubicado).map(([staffId]) => ({ staffId, nombre: byId.get(staffId).name ?? "", servicio: byId.get(staffId).service ?? "" })),
        ultima: answers.map(([, item]) => item.en).sort().at(-1) ?? null,
        porServicio: [...services.values()].sort((a, b) => a.servicio.localeCompare(b.servicio, "es")),
        pendientes: store.pendientes.map((item) => ({ id: item.id, tipo: item.tipo, nombre: item.nombre, servicio: item.servicio, en: item.en, campos: item.campos, actual: item.staffId ? { address: byId.get(item.staffId)?.address ?? "", phone: byId.get(item.staffId)?.phone ?? "", service: byId.get(item.staffId)?.service ?? "" } : null, propuesto: { address: item.datos.address, phone: item.datos.phone, service: item.datos.servicio ?? "" } })),
        ayuda: Object.entries(AYUDA).map(([clave, lugar]) => ({ clave, lugar, personas: answers.filter(([, item]) => item.ayuda?.includes(clave)).map(([staffId]) => ({ nombre: byId.get(staffId).name ?? "", servicio: byId.get(staffId).service ?? "", rol: byId.get(staffId).role ?? "" })) })),
        soloSuServicio: answers.filter(([, item]) => Array.isArray(item.ayuda) && !item.ayuda.length).length,
        geocodeHoy: store.geocode.dia === new Date(now()).toISOString().slice(0, 10) ? store.geocode.n : 0, geocodeTope: config.geocodePerDay, mapaConfigurado: Boolean(maps.serverKey),
      };
    },

    /** Dirección acepta o descarta un cambio pendiente. Aceptar lo aplica como dato confirmado. */
    async resolver(input, actor) {
      const item = readAutogestion(dataDir, secret).pendientes.find((entry) => entry.id === String(input?.id ?? ""));
      if (!item) throw new Error("pendiente");
      if (!["aceptar", "descartar"].includes(input?.accion)) throw new Error("accion");
      if (input.accion === "aceptar") {
        let staffId = item.staffId;
        if (item.tipo === "nueva") {
          staffId = `autogestion--${item.dni}`;
          upsertPrivateContact(dataDir, secret, { staffId, name: item.nombre, service: item.servicio, role: item.datos.rol, dni: item.dni, address: item.datos.address, phone: item.datos.phone, transportMode: item.datos.transportMode }, actor);
        }
        await apply(staffId, item.datos, true);
      }
      mutate((store) => { store.pendientes = store.pendientes.filter((entry) => entry.id !== item.id); });
      return { accion: input.accion, tipo: item.tipo, staffId: item.staffId ?? null };
    },
  };
}
