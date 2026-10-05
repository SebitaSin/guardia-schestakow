import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, loadAuthConfig } from "./auth.mjs";
import { productionEnv } from "../scripts/exportar-env.mjs";

const users = JSON.stringify([{ id: "prueba", name: "Usuario de prueba", role: "ADMIN", passwordHash: hashPassword("clave-de-prueba-123") }]);
const secret = "s".repeat(40);

test("el archivo de publicación alcanza para arrancar la autenticación sin archivos", () => {
  const out = productionEnv({ APP_SESSION_SECRET: secret, HOSPITAL_IMAP_ACCOUNT: "a@b.c", HOSPITAL_IMAP_PASSWORD: "abcd efgh ijkl mnop" }, users);
  assert.deepEqual(out.blocking, []);
  assert.deepEqual(out.odd, []);
  const env = Object.fromEntries(out.text.trim().split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  assert.equal(env.HOSPITAL_IMAP_PASSWORD, "abcd efgh ijkl mnop");
  assert.equal(env.GMAIL_SYNC_ENABLED, "true");
  const config = loadAuthConfig(env);
  assert.equal(config.users[0].id, "prueba");
  assert.equal(config.secureCookie, true);
  assert.equal(config.trustProxy, true);
  assert.ok(out.missing.includes("WHATSAPP_APP_SECRET"));
});

test("sin clave de sesión o sin correo la exportación avisa que falta lo obligatorio", () => {
  const out = productionEnv({}, users);
  assert.deepEqual(out.blocking, ["APP_SESSION_SECRET", "HOSPITAL_IMAP_ACCOUNT", "HOSPITAL_IMAP_PASSWORD"]);
});

test("detrás del proxy, los intentos fallidos de una dirección no bloquean el ingreso de las demás", async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { createHospitalServer } = await import("./app.mjs");
  const root = mkdtempSync(join(tmpdir(), "sch-deploy-test-"));
  mkdirSync(join(root, "dist")); mkdirSync(join(root, "data"));
  writeFileSync(join(root, "dist", "index.html"), "<!doctype html>");
  const authConfig = { ...loadAuthConfig({ APP_SESSION_SECRET: secret, APP_USERS_B64: Buffer.from(users).toString("base64"), APP_TRUST_PROXY: "true", APP_COOKIE_SECURE: "false" }) };
  const waConfig = { verifyToken: "", accessToken: "", appSecret: "", phoneNumberId: "", groupId: "", graphVersion: "" };
  const server = createHospitalServer({ distDir: join(root, "dist"), dataDir: join(root, "data"), authConfig, waConfig });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = (ip, password) => fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip }, body: `user=prueba&password=${password}` });
  try {
    for (let i = 0; i < 5; i += 1) assert.equal((await login("203.0.113.9", "mala")).status, 401);
    assert.equal((await login("203.0.113.9", "clave-de-prueba-123")).status, 429);
    const other = await login("198.51.100.7", "clave-de-prueba-123");
    assert.ok(other.status < 400, `otra dirección entra (${other.status})`);
  } finally { await new Promise((resolve) => server.close(resolve)); rmSync(root, { recursive: true, force: true }); }
});
