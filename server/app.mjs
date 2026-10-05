import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { appendAudit, readJson, writeJsonAtomic } from "./store.mjs";
import { clearSessionCookie, issueSession, parseCookie, readSession, sessionCookie, verifyPassword } from "./auth.mjs";
import { findWhatsAppMedia, receiveWhatsApp, whatsappCanSend, whatsappInbox, whatsappReady } from "./whatsapp.mjs";
import { applyStatusUpdates, approveOutbound, deliverOutbound, outboxSummary, queueOutbound, readOutbox, rejectOutbound, serviceWindowStatus } from "./whatsapp-send.mjs";
import { cancelSchedule, createSchedule, readSchedules } from "./whatsapp-schedules.mjs";
import { aiReady, aiUsageStatus, analyzeBoardImage, verifyOpenAi } from "./ai.mjs";
import { captureInbox, findCapture, recordHumanReview, saveManualCapture } from "./capture.mjs";
import { applyCatalogSwap, catalogState } from "./catalog.mjs";
import { confirmIdentity, identityMarks } from "./identity.mjs";
import { deletePrivateLocation, readPrivateLocations, upsertPrivateLocation } from "./private-locations.mjs";
import { deletePrivateContact, readPrivateContacts, upsertPrivateContact } from "./private-contacts.mjs";
import { originalStaff, staffDirectory } from "./staff-directory.mjs";
import { readStaffGroups, saveStaffGroup, deleteStaffGroup, saveGroupDraft } from "./staff-groups.mjs";
import { geocodeWithGoogle } from "./maps.mjs";
import { communicationsInbox, reviewCommunication, saveManualCommunication } from "./communications.mjs";
import { verifyBoardRows } from "./board-verification.mjs";
import { applyLearnedCorrections, correctionStatus, recordBoardCorrections } from "./corrections.mjs";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".png", "image/png"], [".webmanifest", "application/manifest+json"],
]);

const roleLabels = { VIEWER: "Consulta", STAFF: "Plantel", DRIVER: "Conductor", COORDINATOR: "Coordinación", DIRECTION: "Dirección", ADMIN: "Admin técnico" };

function send(res, status, body, type = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
  res.end(body);
}

function json(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8", headers);
}

function securityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  res.setHeader("content-security-policy", "default-src 'self'; img-src 'self' data: blob: https://maps.gstatic.com https://*.googleapis.com https://*.ggpht.com; style-src 'self' 'unsafe-inline'; script-src 'self' https://maps.googleapis.com; connect-src 'self' https://api.open-meteo.com https://maps.googleapis.com https://routes.googleapis.com https://maps.gstatic.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

async function readBody(req, maxBytes = 16_384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function loginPage(error = "") {
  const notice = error ? `<p role="alert">${error}</p>` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso privado · Hospital Schestakow</title><style>body{font-family:system-ui;margin:0;background:#f3f4f6;color:#172033;min-height:100vh;display:grid;place-items:center}.box{width:min(92vw,390px);background:white;padding:28px;border-radius:18px;box-shadow:0 15px 45px #0002}h1{font-size:1.35rem;margin:0 0 6px}p{color:#5d6678}label{display:block;margin:14px 0 5px;font-weight:650}input,button{box-sizing:border-box;width:100%;min-height:48px;border-radius:10px;border:1px solid #c9ced8;padding:10px;font:inherit}button{margin-top:18px;background:#164e63;color:white;border:0;font-weight:700}</style></head><body><main class="box"><h1>Hospital Schestakow</h1><p>Acceso privado. Las acciones quedan asociadas al usuario.</p>${notice}<form method="post" action="/api/login"><label for="user">Usuario</label><input id="user" name="user" autocomplete="username" required><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>Ingresar</button></form></main></body></html>`;
}

function form(body) {
  return Object.fromEntries(new URLSearchParams(body.toString("utf8")));
}

function hasRole(user, roles) {
  return user && roles.includes(user.role);
}

function html(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function statePath(dataDir) { return join(dataDir, "continuidad", "control.json"); }
function controlState(dataDir) {
  return readJson(statePath(dataDir), { emergency: false, minima: {}, closures: [], staffMarks: [], updatedAt: null });
}
function saveControl(dataDir, state) {
  writeJsonAtomic(statePath(dataDir), { ...state, updatedAt: new Date().toISOString() });
}

function clientControl(state, user) {
  const allMarks = state.staffMarks ?? [];
  const staffMarks = hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])
    ? allMarks
    : hasRole(user, ["STAFF", "DRIVER"]) && user.staffId
      ? allMarks.filter((item) => item.staff_id === user.staffId)
      : [];
  return { emergency: Boolean(state.emergency), minima: state.minima ?? {}, closures: state.closures ?? [], staffMarks, role: user.role, staffId: user.staffId };
}

function driverPage(user) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recorrido privado</title><style>body{font-family:system-ui;margin:0;background:#f3f4f6;color:#172033}.box{max-width:520px;margin:28px auto;padding:22px}.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px #0001}button{min-height:48px;padding:0 18px;border:0;border-radius:10px;background:#164e63;color:white;font-weight:700}</style></head><body><main class="box"><div class="card"><h1>Recorrido del conductor</h1><p>${html(user.name)}</p><p id="state">Consultando asignación…</p><p>El sistema no despacha personas automáticamente. La coordinación confirma cada recorrido.</p><form method="post" action="/api/logout"><button>Salir</button></form></div></main><script src="/driver.js"></script></body></html>`;
}

const DRIVER_SCRIPT = `fetch('/api/continuidad/control').then(r=>r.json()).then(s=>{const m=(s.staffMarks||[])[0];document.getElementById('state').textContent=m?.pickup_id?'Punto asignado: '+m.pickup_id:'Sin recorrido confirmado por Coordinación.'}).catch(()=>{document.getElementById('state').textContent='Estado no disponible.'});`;

function safeStaticPath(distDir, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const relative = decoded === "/" || !extname(decoded) ? "index.html" : normalize(decoded).replace(/^[/\\]+/, "");
  const full = resolve(distDir, relative);
  return full === resolve(distDir) || full.startsWith(resolve(distDir) + sep) ? full : null;
}

function findMailAttachment(dataDir, id) {
  if (!/^[a-f0-9]{16}$/i.test(String(id))) return null;
  const item = readJson(join(dataDir, "mail", "pending.json"), []).find((candidate) => candidate.id === id);
  const hash = String(item?.sha256 ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const rawSuffix = extname(String(item.filename ?? "")).toLowerCase();
  const suffix = /^\.[a-z0-9]{1,10}$/.test(rawSuffix) ? rawSuffix : ".bin";
  const root = resolve(dataDir, "mail", "attachments");
  const path = resolve(root, `${hash}${suffix}`);
  if (!path.startsWith(root + sep) || !existsSync(path)) return null;
  const filename = String(item.filename || `cronograma${suffix}`).replace(/[\r\n"]/g, "_").slice(0, 180);
  return { path, filename };
}

export function createHospitalServer({ distDir, dataDir, catalogFile = null, internacionFile = null, authConfig, waConfig, ai = { enabled: false }, maps = { browserKey: "", serverKey: "" }, mailRunner = null, fetchImpl = fetch }) {
  const failures = new Map();
  return createServer(async (req, res) => {
    securityHeaders(res);
    const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
    const url = new URL(req.url ?? "/", origin);
    const forwarded = authConfig.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",").pop().trim() : "";
    const ip = forwarded || (req.socket.remoteAddress ?? "unknown");
    try {
      if (url.pathname === "/api/health" && req.method === "GET") return json(res, 200, { ok: true });

      if (url.pathname === "/api/whatsapp/webhook") {
        if (req.method === "GET") {
          if (!whatsappReady(waConfig)) return send(res, 503, "not configured");
          const valid = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === waConfig.verifyToken;
          return valid ? send(res, 200, url.searchParams.get("hub.challenge") ?? "") : send(res, 403, "forbidden");
        }
        if (req.method === "POST") {
          const raw = await readBody(req, 10 * 1024 * 1024);
          const result = await receiveWhatsApp({ raw, signature: req.headers["x-hub-signature-256"], dataDir, config: waConfig, fetchImpl });
          if (result.status === 200) applyStatusUpdates(dataDir, authConfig.secret, JSON.parse(raw.toString("utf8")));
          return send(res, result.status, result.body);
        }
        return send(res, 405, "method");
      }

      if (url.pathname === "/login" && req.method === "GET") return send(res, 200, loginPage(), "text/html; charset=utf-8");
      if (url.pathname === "/api/login" && req.method === "POST") {
        const item = failures.get(ip) ?? { count: 0, until: 0 };
        if (item.until > Date.now()) return send(res, 429, "Demasiados intentos. Esperá unos minutos.");
        const body = form(await readBody(req));
        const user = authConfig.users.find((candidate) => candidate.id.toLowerCase() === String(body.user ?? "").trim().toLowerCase());
        if (!user || !verifyPassword(String(body.password ?? ""), user.passwordHash)) {
          const count = item.count + 1;
          failures.set(ip, count >= 5 ? { count: 0, until: Date.now() + 15 * 60_000 } : { count, until: 0 });
          return send(res, 401, loginPage("Usuario o contraseña incorrectos."), "text/html; charset=utf-8");
        }
        failures.delete(ip);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "login", kind: "security" });
        return send(res, 303, "", "text/plain; charset=utf-8", { location: user.role === "DRIVER" ? "/driver" : "/", "set-cookie": sessionCookie(issueSession(user, authConfig), authConfig) });
      }

      const user = readSession(parseCookie(req.headers.cookie, "sch_session"), authConfig);
      if (!user) {
        if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "unauthorized" });
        return send(res, 302, "", "text/plain; charset=utf-8", { location: "/login" });
      }

      if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "") && req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host) return json(res, 403, { error: "cross_site_request_blocked" });
      }

      if (url.pathname === "/api/logout" && req.method === "POST") {
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "logout", kind: "security" });
        return send(res, 303, "", "text/plain; charset=utf-8", { location: "/login", "set-cookie": clearSessionCookie(authConfig) });
      }
      if (url.pathname === "/api/session" && req.method === "GET") return json(res, 200, { id: user.id, name: user.name, role: user.role, roleLabel: roleLabels[user.role], staffId: user.staffId });
      if (url.pathname === "/api/personal/directory" && req.method === "GET") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, { people: staffDirectory(dataDir, authConfig.secret) });
      }
      if (url.pathname === "/api/personal/messaging-directory" && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const people = staffDirectory(dataDir, authConfig.secret).map(({ staffId, name, service, role, phone }) => ({ staffId, name, service, role, phone }));
        return json(res, 200, { people });
      }
      if (url.pathname === "/api/personal/groups") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        if (req.method === "GET") return json(res, 200, { groups: readStaffGroups(dataDir, authConfig.secret) });
        const body = JSON.parse((await readBody(req, 512_000)).toString("utf8"));
        if (req.method === "POST") {
          const group = saveStaffGroup(dataDir, authConfig.secret, body, user.id);
          appendAudit(dataDir, { actor: user.id, action: "save_staff_group", groupId: group.id, memberCount: group.memberIds.length });
          return json(res, 200, { group });
        }
        if (req.method === "PATCH") return json(res, 200, { group: saveGroupDraft(dataDir, authConfig.secret, body.id, body.text, user.id) });
        if (req.method === "DELETE") return json(res, 200, { deleted: deleteStaffGroup(dataDir, authConfig.secret, body.id) });
        return json(res, 405, { error: "method_not_allowed" });
      }
      if (url.pathname === "/api/maps/config" && req.method === "GET") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, { configured: Boolean(maps.browserKey && maps.serverKey), browserKey: maps.browserKey || null, routesKey: maps.serverKey || null });
      }
      if (url.pathname === "/api/maps/geocode" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const result = await geocodeWithGoogle(body.address, maps, fetchImpl);
        return json(res, 200, result);
      }
      if (url.pathname === "/api/continuidad/private-locations" && req.method === "GET") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, { locations: readPrivateLocations(dataDir, authConfig.secret) });
      }
      if (url.pathname === "/api/personal/source-audit" && req.method === "GET") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const path = join(dataDir, "continuidad", "personal-source-audit.json");
        if (!existsSync(path)) return json(res, 404, { error: "audit_not_available" });
        const report = JSON.parse(readFileSync(path, "utf8"));
        const { sourceCsv, sourceXlsx, ...safe } = report;
        return json(res, 200, safe);
      }
      if (url.pathname === "/api/continuidad/private-locations" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        if (body.expectedAddress !== undefined) {
          const current = staffDirectory(dataDir, authConfig.secret).find((item) => item.staffId === body.staffId);
          if (!current || current.address !== body.expectedAddress) return json(res, 409, { error: "stale_private_address" });
        }
        const location = upsertPrivateLocation(dataDir, authConfig.secret, body, user.id);
        const contact = readPrivateContacts(dataDir, authConfig.secret).find((item) => item.staffId === location.staffId);
        if (contact) upsertPrivateContact(dataDir, authConfig.secret, { staffId: contact.staffId, address: body.address, transportMode: location.transportMode }, user.id);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "upsert_private_staff_location", kind: "human_decision", staffId: location.staffId, transportMode: location.transportMode });
        return json(res, 200, { location });
      }
      if (url.pathname === "/api/continuidad/private-locations" && req.method === "DELETE") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const deleted = deletePrivateLocation(dataDir, authConfig.secret, body.staffId);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "delete_private_staff_location", kind: "human_decision", staffId: String(body.staffId ?? ""), deleted });
        return json(res, 200, { deleted });
      }
      if (url.pathname === "/api/continuidad/private-contacts" && req.method === "GET") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, { contacts: readPrivateContacts(dataDir, authConfig.secret) });
      }
      if (url.pathname === "/api/continuidad/private-contacts" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const original = originalStaff.find((item) => item.staffId === body.staffId);
        if (original && body.name !== undefined && body.name !== original.name) return json(res, 400, { error: "staff_name_locked" });
        const previousContact = readPrivateContacts(dataDir, authConfig.secret).find((item) => item.staffId === body.staffId);
        const previousPoint = readPrivateLocations(dataDir, authConfig.secret).find((item) => item.staffId === body.staffId);
        const contact = upsertPrivateContact(dataDir, authConfig.secret, { ...(!previousContact && original ? { name: original.name, service: original.service } : {}), ...body }, user.id);
        const changedAddress = previousContact ? previousContact.address !== contact.address : Boolean(previousPoint && previousPoint.address !== contact.address);
        let location = previousPoint ?? null;
        let locationStatus = contact.address ? "pending_verification" : "no_address";
        if (changedAddress || !contact.address) {
          if (previousPoint) deletePrivateLocation(dataDir, authConfig.secret, contact.staffId);
          location = null;
        }
        if (location) {
          if (contact.transportMode && contact.transportMode !== location.transportMode) location = upsertPrivateLocation(dataDir, authConfig.secret, { ...location, transportMode: contact.transportMode }, user.id);
          locationStatus = "verified";
        }
        if (!location && contact.address && maps.serverKey && body.verifyAddress !== false) {
          try {
            const point = await geocodeWithGoogle(contact.address, maps, fetchImpl);
            location = upsertPrivateLocation(dataDir, authConfig.secret, { staffId: contact.staffId, address: point.address, lat: point.lat, lng: point.lng, transportMode: contact.transportMode ?? previousPoint?.transportMode ?? "UNKNOWN" }, user.id);
            locationStatus = "verified";
          } catch (error) {
            locationStatus = String(error?.message ?? "geocode_failed");
          }
        }
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "upsert_private_staff_contact", kind: "human_decision", staffId: contact.staffId, fields: ["address", "phone", "email", "dni", "service", "transportMode"].filter((field) => body[field] !== undefined) });
        return json(res, 200, { contact, location, locationStatus });
      }
      if (url.pathname === "/api/continuidad/private-contacts" && req.method === "DELETE") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const deleted = deletePrivateContact(dataDir, authConfig.secret, body.staffId);
        if (deleted) deletePrivateLocation(dataDir, authConfig.secret, body.staffId);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "delete_private_staff_contact", kind: "human_decision", staffId: String(body.staffId ?? ""), deleted });
        return json(res, 200, { deleted });
      }
      if (url.pathname === "/driver" && req.method === "GET" && user.role === "DRIVER") return send(res, 200, driverPage(user), "text/html; charset=utf-8");
      if (url.pathname === "/driver.js" && req.method === "GET" && user.role === "DRIVER") return send(res, 200, DRIVER_SCRIPT, "text/javascript; charset=utf-8");
      if (url.pathname === "/api/whatsapp/inbox" && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, whatsappInbox(dataDir, waConfig));
      }
      if (url.pathname.startsWith("/api/whatsapp/media/") && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const id = decodeURIComponent(url.pathname.slice("/api/whatsapp/media/".length));
        const item = findWhatsAppMedia(dataDir, id);
        if (!item) return json(res, 404, { error: "whatsapp_media_not_found" });
        const type = String(item.media_type ?? "image/jpeg").startsWith("image/") ? String(item.media_type) : "image/jpeg";
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "download_whatsapp_media", kind: "data_access", entity: id });
        return send(res, 200, readFileSync(item.path), type, { "content-disposition": `attachment; filename="whatsapp-${encodeURIComponent(id)}.jpg"` });
      }
      if (url.pathname === "/api/whatsapp/config") return json(res, 405, { error: "server_environment_only" });
      if (url.pathname === "/api/whatsapp/outbox" && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, { configured: whatsappReady(waConfig), canSend: whatsappCanSend(waConfig), canApprove: hasRole(user, ["DIRECTION", "ADMIN"]), summary: outboxSummary(dataDir, authConfig.secret), items: readOutbox(dataDir, authConfig.secret).map((record) => ({ ...record, serviceWindow: serviceWindowStatus(dataDir, record.to) })) });
      }
      if (url.pathname === "/api/whatsapp/outbox" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8"));
        const record = queueOutbound(dataDir, authConfig.secret, body, user.id);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "whatsapp_draft", kind: "human_decision", entity: record.id, to: record.to });
        return json(res, 201, { record });
      }
      if (url.pathname === "/api/whatsapp/outbox/action" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8"));
        const id = String(body.id ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: "invalid_outbound_id" });
        let record;
        if (body.action === "approve") record = approveOutbound(dataDir, authConfig.secret, id, user.id);
        else if (body.action === "reject") record = rejectOutbound(dataDir, authConfig.secret, id, user.id, body.reason);
        else if (body.action === "send") record = await deliverOutbound({ dataDir, secret: authConfig.secret, id, config: waConfig, fetchImpl });
        else return json(res, 400, { error: "invalid_outbound_action" });
        appendAudit(dataDir, { actor: user.id, role: user.role, action: `whatsapp_${body.action}`, kind: "human_decision", entity: id, to: record.to, status: record.estado });
        return json(res, 200, { record });
      }
      if (url.pathname === "/api/whatsapp/schedules") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        if (req.method === "GET") return json(res, 200, { schedules: readSchedules(dataDir, authConfig.secret) });
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8"));
        if (req.method === "POST") {
          const schedule = createSchedule(dataDir, authConfig.secret, body, user.id);
          appendAudit(dataDir, { actor: user.id, role: user.role, action: "whatsapp_schedule_create", kind: "human_decision", entity: schedule.id, recipients: schedule.recipientCount, recurrence: schedule.recurrence });
          return json(res, 201, { schedule });
        }
        if (req.method === "DELETE") {
          cancelSchedule(dataDir, authConfig.secret, String(body.id ?? ""));
          appendAudit(dataDir, { actor: user.id, role: user.role, action: "whatsapp_schedule_cancel", kind: "human_decision", entity: String(body.id ?? "") });
          return json(res, 200, { cancelled: true });
        }
        return json(res, 405, { error: "method_not_allowed" });
      }

      if (url.pathname === "/api/communications" && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, communicationsInbox({ dataDir, secret: authConfig.secret, waConfig }));
      }
      if (url.pathname === "/api/communications/manual" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8"));
        const item = saveManualCommunication({ dataDir, secret: authConfig.secret, sender: body.sender, text: body.text, actor: user.id });
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "record_received_communication", kind: "data_capture", entity: item.id, category: item.category });
        return json(res, 201, { item });
      }
      if (url.pathname === "/api/communications/review" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8"));
        const review = reviewCommunication({ dataDir, secret: authConfig.secret, id: body.id, status: String(body.status ?? ""), category: String(body.category ?? ""), actor: user.id });
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "review_communication", kind: "human_decision", entity: review.id, category: review.category, status: review.status });
        return json(res, 200, { review });
      }

      if (url.pathname === "/api/capture/inbox" && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, { inbox: captureInbox(dataDir) });
      }
      if (url.pathname.startsWith("/api/capture/image/") && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const capture = findCapture(dataDir, decodeURIComponent(url.pathname.slice("/api/capture/image/".length)), { pendingOnly: false });
        if (!capture) return json(res, 404, { error: "capture_not_found" });
        const extension = extname(capture.path).toLowerCase();
        const type = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
        return send(res, 200, readFileSync(capture.path), type);
      }
      if (url.pathname === "/api/capture/upload" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const bytes = await readBody(req, 15 * 1024 * 1024);
        let originalName = String(req.headers["x-file-name"] ?? "foto");
        try { originalName = decodeURIComponent(originalName); } catch { originalName = "foto"; }
        const saved = saveManualCapture({ dataDir, bytes, contentType: req.headers["content-type"], originalName, actor: user.id });
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "manual_image_capture", kind: "data_capture", sourceHash: saved.item.hash, duplicate: saved.duplicate });
        return json(res, saved.duplicate ? 200 : 201, { item: { ...saved.item, path: undefined }, duplicate: saved.duplicate });
      }
      if (url.pathname === "/api/capture/review" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8"));
        const capture = findCapture(dataDir, String(body.captureId ?? ""));
        if (!capture) return json(res, 404, { error: "capture_not_found" });
        const review = recordHumanReview({ dataDir, capture, actor: user.id, role: user.role, decision: String(body.decision ?? ""), rows: body.rows });
        const original = readJson(join(dataDir, "ai", "cache", `${capture.hash}.json`), null);
        const learning = review.decision === "CONFIRMADA" && Array.isArray(original?.rows)
          ? recordBoardCorrections({ dataDir, secret: authConfig.secret, sourceHash: capture.hash, originalRows: original.rows, correctedRows: review.rows, actor: user.id })
          : { recorded: 0 };
        appendAudit(dataDir, { actor: user.id, role: user.role, action: review.decision === "CONFIRMADA" ? "confirm_transcription" : "discard_transcription", kind: "human_decision", sourceHash: capture.hash, rowCount: review.rows.length, correctionsLearned: learning.recorded });
        return json(res, 200, review);
      }

      if (url.pathname === "/api/ai/status" && req.method === "GET") {
        return json(res, 200, { configured: aiReady(ai), enabled: Boolean(ai.enabled), model: ai.model || null, usage: aiUsageStatus(dataDir, ai) });
      }
      if (url.pathname === "/api/ai/verify" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, await verifyOpenAi(ai, fetchImpl));
      }
      if (url.pathname === "/api/ai/corrections/status" && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, correctionStatus(dataDir, authConfig.secret));
      }
      if (url.pathname === "/api/ai/interpret" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const captureId = String(body.captureId ?? body.messageId ?? "");
        const item = findCapture(dataDir, captureId);
        if (!item) return json(res, 404, { error: "captured_image_not_found" });
        const result = await analyzeBoardImage({ imagePath: item.path, sourceHash: item.hash, dataDir, config: ai, fetchImpl });
        const learnedRows = applyLearnedCorrections({ dataDir, secret: authConfig.secret, rows: result.rows });
        const verification = verifyBoardRows({ rows: learnedRows, dataDir, internacionFile });
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "ai_board_transcription", kind: "ai_recommendation", sourceHash: item.hash, model: result.model, cached: result.cached, status: verification.status, verifiedRows: verification.summary.verified, reviewRows: verification.summary.review, conflictRows: verification.summary.conflicts });
        return json(res, 200, { ...result, rows: verification.rows, status: verification.status, verificationSummary: verification.summary });
      }

      if (url.pathname === "/api/audit" && req.method === "GET") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, { events: readJson(join(dataDir, "audit.json"), []).slice(0, 500) });
      }

      if (url.pathname === "/api/catalog/state" && req.method === "GET") return json(res, 200, catalogState(dataDir));
      if (url.pathname === "/api/catalog/live" && req.method === "GET") {
        // Cronogramas leídos automáticamente del correo (scripts/ingest_pending.py).
        const live = readJson(join(dataDir, "catalog", "live.json"), { generatedAt: null, documents: [] });
        const mail = readJson(join(dataDir, "mail", "status.json"), { status: "unknown", at: null });
        return json(res, 200, { generatedAt: live.generatedAt ?? null, documents: Array.isArray(live.documents) ? live.documents : [], unread: (Array.isArray(live.unread) ? live.unread : []).map((item) => ({ id: String(item?.id ?? ""), filename: String(item?.filename ?? ""), mailDate: String(item?.mailDate ?? ""), departments: Array.isArray(item?.departments) ? item.departments : [] })), mail: { status: mail.status ?? "unknown", at: mail.at ?? null }, running: Boolean(mailRunner?.running) });
      }
      if (url.pathname === "/api/catalog/refresh" && req.method === "POST") {
        // Botón "Actualizar": cualquier usuario autenticado puede pedir que se revise el correo.
        if (!mailRunner) return json(res, 503, { error: "sync_not_available" });
        Promise.resolve().then(() => mailRunner.run()).catch(() => undefined);
        return json(res, 202, { started: true });
      }
      if (url.pathname === "/api/catalog/change" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8"));
        const result = applyCatalogSwap({ dataDir, catalogFile, actor: user.id, role: user.role, input: body });
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "swap_guard_shift", kind: "human_decision", entity: result.change.docId, before: { [result.change.dateA]: result.change.beforeA, [result.change.dateB]: result.change.beforeB }, after: { [result.change.dateA]: result.change.afterA, [result.change.dateB]: result.change.afterB } });
        return json(res, 200, result);
      }
      if (url.pathname === "/api/identity/marks" && req.method === "GET") return json(res, 200, { marks: identityMarks(dataDir) });
      if (url.pathname === "/api/identity/confirm" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8"));
        const result = confirmIdentity({ dataDir, internacionFile, actor: user.id, role: user.role, input: body });
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "confirm_patient_identity", kind: "human_decision", entity: `${result.mark.slug}:${result.mark.cama}`, source: "HUMAN_CONFIRMED" });
        return json(res, 200, result);
      }

      if (url.pathname === "/api/mail/status" && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, {
          status: readJson(join(dataDir, "mail", "status.json"), { status: "unknown", at: null, account: "" }),
          pending: readJson(join(dataDir, "mail", "pending.json"), []).slice(0, 100),
          running: Boolean(mailRunner?.running),
        });
      }
      if (url.pathname.startsWith("/api/mail/attachment/") && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const id = decodeURIComponent(url.pathname.slice("/api/mail/attachment/".length));
        const attachment = findMailAttachment(dataDir, id);
        if (!attachment) return json(res, 404, { error: "mail_attachment_not_found" });
        const encodedName = encodeURIComponent(attachment.filename).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "download_mail_attachment", kind: "data_access", entity: id });
        return send(res, 200, readFileSync(attachment.path), "application/octet-stream", { "content-disposition": `attachment; filename*=UTF-8''${encodedName}` });
      }
      if (url.pathname === "/api/mail/sync" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        if (!mailRunner) return json(res, 503, { error: "sync_not_available" });
        Promise.resolve().then(() => mailRunner.run()).catch(() => undefined);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "mail_sync_requested", kind: "human_decision" });
        return json(res, 202, { started: true });
      }

      if (url.pathname === "/api/continuidad/control" && req.method === "GET") return json(res, 200, clientControl(controlState(dataDir), user));
      if (url.pathname === "/api/continuidad/emergency" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        if (typeof body.on !== "boolean" || String(body.reason ?? "").trim().length < 5) return json(res, 400, { error: "reason_required" });
        const state = controlState(dataDir); state.emergency = body.on; saveControl(dataDir, state);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: body.on ? "activate_emergency" : "deactivate_emergency", kind: "human_decision", reason: String(body.reason).slice(0, 500) });
        return json(res, 200, clientControl(state, user));
      }
      if (url.pathname === "/api/continuidad/minima" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const value = body.value === null ? null : Number(body.value);
        if (!/^[a-z0-9-]{2,80}$/.test(String(body.service ?? "")) || value !== null && (!Number.isInteger(value) || value < 0 || value > 100)) return json(res, 400, { error: "invalid_minimum" });
        const state = controlState(dataDir); state.minima[String(body.service)] = value; saveControl(dataDir, state);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "set_minimum_staff", kind: "human_decision", service: body.service, value });
        return json(res, 200, clientControl(state, user));
      }
      if (url.pathname === "/api/continuidad/closure" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const edgeId = String(body.edgeId ?? "");
        const closureState = String(body.closureState ?? "");
        if (!/^[a-z0-9_-]{2,80}$/i.test(edgeId) || !["OPEN", "RESTRICTED", "CLOSED", "UNKNOWN"].includes(closureState)) return json(res, 400, { error: "invalid_closure" });
        const state = controlState(dataDir);
        state.closures = (state.closures ?? []).filter((item) => item.edge_id !== edgeId);
        state.closures.push({ edge_id: edgeId, closure_state: closureState, source: "HUMAN_CONFIRMED", updated_at: new Date().toISOString() });
        saveControl(dataDir, state);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "mark_closure", kind: "human_decision", edgeId, closureState });
        return json(res, 200, clientControl(state, user));
      }
      if (url.pathname === "/api/continuidad/staff" && req.method === "POST") {
        if (!hasRole(user, ["STAFF", "DRIVER", "COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const staffId = String(body.staffId ?? "");
        if (!/^[a-z0-9áéíóúüñ._-]{3,120}$/i.test(staffId)) return json(res, 400, { error: "invalid_staff" });
        if (["STAFF", "DRIVER"].includes(user.role) && (!user.staffId || user.staffId !== staffId)) return json(res, 403, { error: "own_record_only" });
        const state = controlState(dataDir);
        const previous = (state.staffMarks ?? []).find((item) => item.staff_id === staffId) ?? {};
        const status = String(body.patch?.transport_status ?? previous.transport_status ?? "UNKNOWN");
        if (!["UNKNOWN", "SELF", "NEEDS_TRANSPORT", "CAN_DRIVE", "UNAVAILABLE", "ARRIVED"].includes(status)) return json(res, 400, { error: "invalid_transport_status" });
        const availability = String(body.patch?.availability_status ?? previous.availability_status ?? "UNKNOWN");
        if (!["UNKNOWN", "SCHEDULED_ONLY", "CAN_COVER_SHIFT", "CAN_SUPPORT_OTHER_SERVICE", "UNAVAILABLE"].includes(availability)) return json(res, 400, { error: "invalid_availability_status" });
        const disasterSupport = String(body.patch?.disaster_support_status ?? previous.disaster_support_status ?? "UNKNOWN");
        if (!["UNKNOWN", "YES", "NO"].includes(disasterSupport)) return json(res, 400, { error: "invalid_disaster_support_status" });
        const areasInput = body.patch?.disaster_support_areas === undefined ? previous.disaster_support_areas ?? [] : body.patch.disaster_support_areas;
        if (!Array.isArray(areasInput) || areasInput.length > 12 || areasInput.some((area) => !/^[a-z0-9áéíóúüñ._-]{2,80}$/i.test(String(area)))) return json(res, 400, { error: "invalid_disaster_support_areas" });
        const disasterAreas = disasterSupport === "YES" ? [...new Set(areasInput.map((area) => String(area)))].slice(0, 12) : [];
        const capacityInput = body.patch?.vehicle_capacity === undefined ? previous.vehicle_capacity : body.patch.vehicle_capacity;
        const capacity = capacityInput == null ? null : Number(capacityInput);
        if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 20)) return json(res, 400, { error: "invalid_capacity" });
        const textOrPrevious = (key, max = 80) => body.patch?.[key] === undefined ? previous[key] ?? null : body.patch[key] ? String(body.patch[key]).slice(0, max) : null;
        const boolOrPrevious = (key) => body.patch?.[key] === undefined ? previous[key] ?? null : typeof body.patch[key] === "boolean" ? body.patch[key] : null;
        const mark = {
          staff_id: staffId,
          transport_status: status,
          availability_status: availability,
          support_service: textOrPrevious("support_service", 80),
          disaster_support_status: disasterSupport,
          disaster_support_areas: disasterAreas,
          operational_zone: textOrPrevious("operational_zone"),
          pickup_id: textOrPrevious("pickup_id"),
          vehicle_available: boolOrPrevious("vehicle_available"),
          vehicle_capacity: capacity,
          can_transport_others: boolOrPrevious("can_transport_others"),
          source: "HUMAN_CONFIRMED",
          updated_at: new Date().toISOString(),
        };
        state.staffMarks = (state.staffMarks ?? []).filter((item) => item.staff_id !== staffId);
        state.staffMarks.push(mark); saveControl(dataDir, state);
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "mark_staff", kind: "human_decision", staffId, transportStatus: status, availabilityStatus: availability, supportService: mark.support_service, disasterSupport, disasterAreas: disasterAreas.length });
        return json(res, 200, clientControl(state, user));
      }
      if (url.pathname === "/api/continuidad/review" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const routeId = String(body.routeId ?? "");
        if (!/^[a-z0-9._:-]{2,120}$/i.test(routeId)) return json(res, 400, { error: "invalid_route" });
        appendAudit(dataDir, { actor: user.id, role: user.role, action: "review_shadow_route", kind: "human_decision", routeId });
        return json(res, 200, { ok: true });
      }

      if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "not_found" });
      if (user.role === "DRIVER") return send(res, 302, "", "text/plain; charset=utf-8", { location: "/driver" });
      const path = safeStaticPath(distDir, url.pathname);
      if (!path) return send(res, 400, "bad path");
      try {
        const stat = statSync(path);
        if (!stat.isFile()) throw Object.assign(new Error("not file"), { code: "ENOENT" });
        res.writeHead(200, { "content-type": MIME.get(extname(path)) ?? "application/octet-stream", "cache-control": "no-store" });
        res.end(readFileSync(path));
      } catch (error) {
        if (error?.code === "ENOENT") return send(res, 404, "not found");
        throw error;
      }
    } catch (error) {
      appendAudit(dataDir, { actor: "system", action: "request_error", kind: "system", error: error instanceof Error ? error.name : "Error", path: url.pathname });
      const clientErrors = new Set(["image_size_invalid", "invalid_image_content", "invalid_rows", "invalid_row", "invalid_confidence", "invalid_boolean", "invalid_decision", "invalid_catalog_change", "catalog_names_not_found", "catalog_invalid_swap", "invalid_identity_confirmation", "invalid_private_location", "invalid_geocode_address", "geocode_not_found", "invalid_communication", "invalid_communication_review"]);
      for (const code of ["invalid_private_contact", "staff_name_locked", "invalid_staff_group", "invalid_staff_group_members", "invalid_group_message"]) clientErrors.add(code);
      for (const code of ["invalid_schedule", "schedule_not_found"]) clientErrors.add(code);
      for (const code of ["invalid_recipient", "invalid_kind", "invalid_actor", "invalid_motivo", "invalid_body", "invalid_template_name", "invalid_language_code", "invalid_template_params", "invalid_outbound_id", "invalid_outbound_action", "outbound_not_draft", "outbound_not_pending", "outbound_not_approved", "service_window_closed", "duplicate_send", "send_rate_limit"]) clientErrors.add(code);
      const status = error?.message === "body_too_large" ? 413
        : error?.message === "unsupported_image_type" ? 415
          : error?.message === "catalog_conflict" || error?.message === "schedule_limit" ? 409
            : error?.message === "catalog_document_not_found" || error?.message === "bed_not_found_or_not_occupied" ? 404
              : error?.message === "outbound_not_found" ? 404
              : error?.message === "whatsapp_not_configured" ? 503
              : String(error?.message ?? "").startsWith("whatsapp_send_") ? 502
              : clientErrors.has(error?.message) || error instanceof SyntaxError ? 400
            : String(error?.message ?? "") === "google_maps_not_configured" || String(error?.message ?? "").startsWith("google_maps_") ? 503
            : String(error?.message ?? "").startsWith("ai_monthly_budget") ? 429
              : String(error?.message ?? "").startsWith("ai_") || String(error?.message ?? "").startsWith("openai_") ? 503
                : 500;
      const specificErrors = new Set(["invalid_private_contact", "staff_name_locked", "invalid_staff_group", "invalid_staff_group_members", "invalid_group_message", "invalid_schedule", "schedule_not_found", "invalid_recipient", "invalid_kind", "invalid_motivo", "invalid_body", "invalid_template_name", "invalid_template_params", "outbound_not_found", "outbound_not_draft", "outbound_not_pending", "outbound_not_approved", "service_window_closed", "duplicate_send", "send_rate_limit", "whatsapp_not_configured"]);
      const safeWhatsAppError = /^whatsapp_send_\d{3,6}$/.test(String(error?.message ?? "")) ? error.message : null;
      return json(res, status, { error: safeWhatsAppError ?? (status >= 500 ? "service_unavailable" : specificErrors.has(error?.message) ? error.message : "invalid_request") });
    }
  });
}
