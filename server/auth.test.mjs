import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, issueSession, readSession, verifyPassword } from "./auth.mjs";

test("passwords use salted scrypt and reject wrong values", () => {
  const encoded = hashPassword("una-clave-larga-y-unica", "00112233445566778899aabbccddeeff");
  assert.equal(verifyPassword("una-clave-larga-y-unica", encoded), true);
  assert.equal(verifyPassword("otra-clave-larga", encoded), false);
});

test("signed sessions expire and are bound to the configured user role", () => {
  const user = { id: "direccion", name: "Dirección", role: "DIRECTION", staffId: null };
  const config = { secret: "x".repeat(32), users: [{ ...user, passwordHash: "unused" }], sessionHours: 1, secureCookie: false };
  const token = issueSession(user, config, 1_000);
  assert.equal(readSession(token, config, 2_000)?.role, "DIRECTION");
  assert.equal(readSession(token, config, 3_602_000), null);
  assert.equal(readSession(`${token}x`, config, 2_000), null);
  const changed = { ...config, users: [{ ...config.users[0], role: "VIEWER" }] };
  assert.equal(readSession(token, changed, 2_000), null);
});
