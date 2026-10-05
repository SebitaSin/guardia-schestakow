import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const ROLES = new Set(["VIEWER", "STAFF", "DRIVER", "COORDINATOR", "DIRECTION", "ADMIN"]);

function sameBytes(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  if (typeof password !== "string" || password.length < 12) {
    throw new Error("password_too_short");
  }
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password, encoded) {
  const [kind, salt, expected] = String(encoded ?? "").split("$");
  if (kind !== "scrypt" || !salt || !/^[a-f0-9]{128}$/i.test(expected ?? "")) return false;
  try {
    return sameBytes(scryptSync(String(password), salt, 64), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function validateUser(raw) {
  const id = String(raw?.id ?? "").trim();
  const name = String(raw?.name ?? "").trim();
  const role = String(raw?.role ?? "VIEWER").trim().toUpperCase();
  const passwordHash = String(raw?.passwordHash ?? "");
  const staffId = raw?.staffId ? String(raw.staffId).slice(0, 120) : null;
  if (!/^[a-z0-9._-]{3,64}$/i.test(id) || !name || !ROLES.has(role) || !/^scrypt\$[a-f0-9]+\$[a-f0-9]{128}$/i.test(passwordHash)) {
    throw new Error("invalid_user_config");
  }
  return { id, name: name.slice(0, 120), role, passwordHash, staffId };
}

export function loadAuthConfig(env = process.env) {
  const secret = String(env.APP_SESSION_SECRET ?? "");
  const usersFile = String(env.APP_USERS_FILE ?? "");
  if (secret.length < 32) throw new Error("APP_SESSION_SECRET must have at least 32 characters");
  // En un servidor de internet muchas veces sólo hay variables de entorno: los usuarios pueden venir
  // en APP_USERS_B64 (el mismo JSON de users.local.json, en base64) en lugar de un archivo.
  const inline = String(env.APP_USERS_B64 ?? "").trim();
  if (!usersFile && !inline) throw new Error("APP_USERS_FILE or APP_USERS_B64 is required");
  const parsed = JSON.parse(inline ? Buffer.from(inline, "base64").toString("utf8") : readFileSync(usersFile, "utf8"));
  const users = (Array.isArray(parsed) ? parsed : parsed.users).map(validateUser);
  if (!users.length) throw new Error("At least one user is required");
  if (new Set(users.map((u) => u.id.toLowerCase())).size !== users.length) throw new Error("Duplicate user id");
  return {
    secret,
    users,
    secureCookie: String(env.APP_COOKIE_SECURE ?? "true").toLowerCase() !== "false",
    // Detrás de un proxy HTTPS todas las conexiones llegan desde el proxy: la IP real viene en X-Forwarded-For.
    trustProxy: String(env.APP_TRUST_PROXY ?? "false").toLowerCase() === "true",
    sessionHours: Math.max(1, Math.min(24, Number(env.APP_SESSION_HOURS ?? 8) || 8)),
  };
}

function signature(body, secret) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function issueSession(user, config, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    name: user.name,
    role: user.role,
    staffId: user.staffId,
    exp: now + config.sessionHours * 3_600_000,
  })).toString("base64url");
  return `${payload}.${signature(payload, config.secret)}`;
}

export function readSession(token, config, now = Date.now()) {
  const [payload, provided, extra] = String(token ?? "").split(".");
  if (!payload || !provided || extra || !sameBytes(signature(payload, config.secret), provided)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const current = config.users.find((u) => u.id === data.sub);
    if (!current || data.exp <= now || data.role !== current.role) return null;
    return { id: current.id, name: current.name, role: current.role, staffId: current.staffId, exp: data.exp };
  } catch {
    return null;
  }
}

export function parseCookie(header, name) {
  for (const pair of String(header ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === name) return decodeURIComponent(pair.slice(at + 1).trim());
  }
  return null;
}

export function sessionCookie(token, config) {
  return [`sch_session=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict", config.secureCookie ? "Secure" : "", `Max-Age=${config.sessionHours * 3600}`].filter(Boolean).join("; ");
}

export function clearSessionCookie(config) {
  return ["sch_session=", "Path=/", "HttpOnly", "SameSite=Strict", config.secureCookie ? "Secure" : "", "Max-Age=0"].filter(Boolean).join("; ");
}
